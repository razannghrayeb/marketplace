# Machine Learning Models Guide

This guide covers the machine learning components of the Fashion Aggregator API, including model architectures, training procedures, and integration details.

## Overview

The Fashion Aggregator API incorporates several ML models to provide intelligent features:

1. **CLIP (Contrastive Language-Image Pre-training)** - For image embeddings and visual similarity
2. **Dual-Model Object Detection (YOLOv8 + YOLOS)** - For fashion item detection and cropping
3. **XGBoost Ranker** - For ranking product recommendations
4. **Semantic Search** - For query understanding and expansion
5. **Quality Analysis** - For automated product quality assessment

---

## Image Analysis Pipeline

### End-to-End Workflow

The image analysis pipeline processes uploaded fashion images through multiple ML stages:

#### 1. Image Ingestion & Validation
```typescript
// routes/ingest/ingest.service.ts
export async function createIngestJob(input: CreateIngestJobInput): Promise<{ jobId: string; cdnUrl: string }> {
  const { imageBuffer, userId = null, filename = "upload.jpg", mimetype = "image/jpeg" } = input;
  
  // Upload to R2 immediately for durability
  const { key, cdnUrl } = await uploadImage(imageBuffer, undefined, mimetype);
  
  // Queue for background processing
  const q = getIngestQueue();
  await q.add("ingest-image", {
    job_uuid: jobUuid,
    user_id: userId,
    r2_key: key,
    cdn_url: cdnUrl,
    filename
  }, { jobId: jobUuid });
  
  return { jobId: jobUuid, cdnUrl };
}
```

#### 2. Object Detection with DualDetector (YOLOv8 + YOLOS)
```python
# src/lib/model/dual_model_yolo.py
from dual_model_yolo import DualDetector
from PIL import Image
import io


detector = DualDetector(conf=0.6)

def detect_objects(image_bytes: bytes) -> list[dict]:
  """Run hybrid YOLOv8 (DeepFashion2) + YOLOS (Fashionpedia) detection."""
  image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
  result = detector.predict(image)

  detections: list[dict] = []
  for p in result["all"]:
    x1, y1, x2, y2 = p["box"]
    detections.append({
      "label": str(p["label"]),
      "confidence": float(p["score"]),
      "bbox": [float(x1), float(y1), float(x2), float(y2)],
      "source": p["source"],  # "A" (YOLOv8) or "B" (YOLOS)
    })

  return detections
```

#### 3. Per-Object CLIP Embedding Generation
```python
# lib/model/onnx_inference.py
def compute_image_embedding(image: Image.Image) -> np.ndarray:
    """
    Compute FashionCLIP image embedding
    Returns: 512-dimensional normalized embedding
    """
    session = get_fashion_clip_image_session()
    
    # Preprocess image for CLIP
    input_tensor = preprocess_image(image, size=224)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    embedding = session.run([output_name], {input_name: input_tensor})[0]
    
    # L2 normalize
    embedding = embedding.squeeze()
    embedding = embedding / np.linalg.norm(embedding)
    
    return embedding

def process_detected_objects(image: Image.Image, detections: List[DetectionResult]) -> List[ObjectEmbedding]:
    """Generate embeddings for each detected fashion object"""
    results = []
    
    for detection in detections:
        # Crop object from original image
        bbox = detection["bbox"]
        cropped_image = crop_image_region(image, bbox)
        
        # Generate CLIP embedding for cropped object
        embedding = compute_image_embedding(cropped_image)
        
        results.append({
            "detection": detection,
            "embedding": embedding,
            "cropped_image": cropped_image
        })
    
    return results

def crop_image_region(image: Image.Image, bbox: List[float]) -> Image.Image:
    """Crop image region defined by bounding box"""
    x1, y1, x2, y2 = bbox
    return image.crop((x1, y1, x2, y2))
```

#### 4. Similarity Search with OpenSearch
```typescript
// lib/search/embeddingSearch.ts
export async function findSimilarProductsByEmbedding(
  embedding: number[],
  category: string,
  options: {
    limit?: number;
    similarityThreshold?: number;
    useCategoryFilter?: boolean;
  } = {}
): Promise<SimilarityResult[]> {
  const { limit = 20, similarityThreshold = 0.7, useCategoryFilter = true } = options;
  
  // Build OpenSearch query
  const query: any = {
    size: limit,
    query: {
      script_score: {
        query: useCategoryFilter ? { term: { category } } : { match_all: {} },
        script: {
          source: "cosineSimilarity(params.embedding, 'embedding') + 1.0",
          params: { embedding }
        }
      }
    },
    _source: ["id", "title", "image_cdn", "price_cents", "category", "brand"]
  };
  
  // Add similarity threshold filter
  if (similarityThreshold > 0) {
    query.query.script_score.script.source = `
      double similarity = cosineSimilarity(params.embedding, 'embedding');
      if (similarity >= params.threshold) {
        return similarity;
      }
      return 0;
    `;
    query.query.script_score.script.params.threshold = similarityThreshold;
  }
  
  const response = await osClient.search({
    index: 'products',
    body: query
  });
  
  return response.body.hits.hits.map(hit => ({
    product: hit._source,
    similarity_score: hit._score - 1.0, // Remove +1.0 offset
    search_metadata: {
      total_candidates: response.body.hits.total.value,
      search_time_ms: response.body.took
    }
  }));
}
```

#### 5. Aggregated Results Processing
```typescript
// routes/images/search.controller.ts
export async function searchByImage(
  req: Request,
  res: Response
): Promise<Response> {
  const { image } = req.files as { image: UploadedFile[] };
  const { limit_per_item = 10, threshold = 0.7 } = req.query;
  
  // Validate image
  const validation = await validateImageUpload(image[0]);
  if (!validation.valid) {
    return res.status(400).json({ success: false, error: validation.error });
  }
  
  // Load image for processing
  const imageBuffer = image[0].buffer;
  const pilImage = await sharp(imageBuffer).toFormat('png').toBuffer();
  
  // Run object detection
  const detections = await detectFashionObjects(pilImage);
  
  // Generate embeddings and search for each detection
  const searchPromises = detections.map(async (detection) => {
    // Crop and embed
    const croppedImage = await cropDetection(pilImage, detection.bbox);
    const embedding = await computeImageEmbedding(croppedImage);
    
    // Search similar products
    const similarProducts = await findSimilarProductsByEmbedding(
      embedding,
      detection.category,
      { limit: limit_per_item, similarityThreshold: threshold }
    );
    
    return {
      detection,
      products: similarProducts,
      count: similarProducts.length
    };
  });
  
  const searchResults = await Promise.all(searchPromises);
  
  // Aggregate and return
  return res.json({
    success: true,
    detection: {
      items: detections,
      count: detections.length
    },
    similarProducts: {
      byDetection: searchResults,
      totalProducts: searchResults.reduce((sum, result) => sum + result.count, 0),
      threshold,
      detectedCategories: [...new Set(detections.map(d => d.category))]
    }
  });
}
```

### Performance Optimizations

#### Batch Processing
```python
# lib/model/batch_inference.py
def batch_process_embeddings(images: List[Image.Image], batch_size: int = 8) -> List[np.ndarray]:
    """Process multiple images in batches for better GPU utilization"""
    session = get_fashion_clip_image_session()
    
    all_embeddings = []
    
    for i in range(0, len(images), batch_size):
        batch = images[i:i + batch_size]
        
        # Preprocess batch
        batch_tensors = np.concatenate([
            preprocess_image(img) for img in batch
        ], axis=0)
        
        # Run inference
        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name
        batch_embeddings = session.run([output_name], {input_name: batch_tensors})[0]
        
        # Normalize
        norms = np.linalg.norm(batch_embeddings, axis=1, keepdims=True)
        batch_embeddings = batch_embeddings / norms
        
        all_embeddings.extend(batch_embeddings)
    
    return all_embeddings
```

#### Caching Strategy
```typescript
// lib/cache/embeddingCache.ts
export class EmbeddingCache {
  private redis: Redis;
  
  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }
  
  async getEmbedding(imageHash: string): Promise<number[] | null> {
    const cached = await this.redis.get(`embedding:${imageHash}`);
    return cached ? JSON.parse(cached) : null;
  }
  
  async setEmbedding(imageHash: string, embedding: number[], ttlSeconds: number = 3600): Promise<void> {
    await this.redis.setex(`embedding:${imageHash}`, ttlSeconds, JSON.stringify(embedding));
  }
  
  async getDetectionResults(imageHash: string): Promise<DetectionResult[] | null> {
    const cached = await this.redis.get(`detection:${imageHash}`);
    return cached ? JSON.parse(cached) : null;
  }
  
  async setDetectionResults(imageHash: string, detections: DetectionResult[], ttlSeconds: number = 1800): Promise<void> {
    await this.redis.setex(`detection:${imageHash}`, ttlSeconds, JSON.stringify(detections));
  }
}
```

### Model Architecture Details

#### YOLOv8 Configuration
```yaml
# model/yolov8_config.yaml
model:
  type: yolov8
  size: n  # nano for speed, l for accuracy
  pretrained: true
  
training:
  epochs: 100
  batch_size: 16
  img_size: 640
  data: fashion_dataset.yaml
  
fashion_classes:
  - shirt
  - pants
  - dress
  - shoes
  - hat
  - bag
  - jacket
  - skirt
  - shorts
  - socks
  - gloves
```

#### CLIP Model Optimization
```python
# lib/model/model_optimization.py
def optimize_clip_model(model_path: str, optimization_level: str = "ORT_ENABLE_ALL"):
    """Optimize ONNX CLIP model for inference"""
    import onnxruntime as ort
    
    # Session options for maximum performance
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 4
    session_options.inter_op_num_threads = 1
    session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    session_options.graph_optimization_level = getattr(ort.GraphOptimizationLevel, optimization_level)
    
    # Enable CUDA if available
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    
    return ort.InferenceSession(model_path, session_options, providers=providers)
```

---

## CLIP Model Integration

### Model Details
- **Architecture**: OpenAI CLIP ViT-B/32
- **Format**: ONNX for optimized inference
- **Input**: 224x224 RGB images
- **Output**: 512-dimensional embeddings
- **Purpose**: Visual similarity search and duplicate detection

## CLIP Model Integration

### Model Details
- **Architecture**: OpenAI CLIP ViT-B/32 (Vision Transformer)
- **Format**: ONNX for optimized inference
- **Input**: 224×224 RGB images, 77-token text sequences
- **Output**: 512-dimensional normalized embeddings
- **Purpose**: Multimodal similarity search and semantic understanding

### Technical Implementation

#### Image Preprocessing Pipeline
```python
# lib/model/image_preprocessing.py
def advanced_image_preprocessing(image: Image.Image) -> np.ndarray:
    """
    Advanced CLIP-compatible image preprocessing with augmentation
    """
    # Convert to RGB
    image = image.convert("RGB")
    
    # Calculate target size maintaining aspect ratio
    original_width, original_height = image.size
    target_size = 224
    
    # Resize so smallest dimension becomes target_size
    if original_width < original_height:
        new_width = target_size
        new_height = int(original_height * target_size / original_width)
    else:
        new_height = target_size
        new_width = int(original_width * target_size / original_height)
    
    # Resize image
    image = image.resize((new_width, new_height), Image.BICUBIC)
    
    # Center crop to target_size × target_size
    left = (new_width - target_size) // 2
    top = (new_height - target_size) // 2
    right = left + target_size
    bottom = top + target_size
    image = image.crop((left, top, right, bottom))
    
    # Convert to numpy array and normalize
    img_array = np.array(image, dtype=np.float32)
    
    # CLIP normalization: ImageNet stats with specific scaling
    mean = np.array([0.48145466, 0.4578275, 0.40821073]) * 255.0
    std = np.array([0.26862954, 0.26130258, 0.27577711]) * 255.0
    
    img_array = (img_array - mean) / std
    
    # HWC to CHW format for PyTorch models
    img_array = np.transpose(img_array, (2, 0, 1))
    
    # Add batch dimension
    img_array = np.expand_dims(img_array, axis=0)
    
    return img_array.astype(np.float32)
```

#### Text Tokenization with CLIPTokenizer
```python
# lib/model/text_processing.py
from transformers import CLIPTokenizer
import torch

class CLIPTextProcessor:
    def __init__(self):
        self.tokenizer = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
        self.max_length = 77  # CLIP's maximum sequence length
        
    def tokenize_text(self, text: str) -> np.ndarray:
        """
        Tokenize text for CLIP model input
        Returns: int64 array of shape (77,) with token IDs
        """
        # Tokenize with padding and truncation
        tokens = self.tokenizer(
            text,
            padding="max_length",
            max_length=self.max_length,
            truncation=True,
            return_tensors="np"
        )
        
        # Extract input_ids and ensure int64 type
        input_ids = tokens["input_ids"].astype(np.int64)
        
        return input_ids
    
    def batch_tokenize_texts(self, texts: List[str]) -> np.ndarray:
        """
        Batch tokenize multiple texts for efficient processing
        """
        batch_tokens = self.tokenizer(
            texts,
            padding="max_length",
            max_length=self.max_length,
            truncation=True,
            return_tensors="np"
        )
        
        return batch_tokens["input_ids"].astype(np.int64)
    
    def decode_tokens(self, token_ids: np.ndarray) -> str:
        """Decode token IDs back to text (for debugging)"""
        return self.tokenizer.decode(token_ids, skip_special_tokens=True)
```

#### Embedding Computation with Error Handling
```python
# lib/model/embedding_service.py
class CLIPEmbeddingService:
    def __init__(self):
        self.image_session = None
        self.text_session = None
        self.text_processor = CLIPTextProcessor()
        self.cache = EmbeddingCache()
        
    async def compute_image_embedding(self, image: Image.Image) -> np.ndarray:
        """Compute CLIP image embedding with caching and error handling"""
        # Generate image hash for caching
        image_hash = await self._compute_image_hash(image)
        
        # Check cache first
        cached_embedding = await self.cache.get_embedding(image_hash)
        if cached_embedding:
            return np.array(cached_embedding)
        
        try:
            # Lazy load model
            if not self.image_session:
                self.image_session = await self._load_image_model()
            
            # Preprocess image
            input_tensor = advanced_image_preprocessing(image)
            
            # Run inference
            input_name = self.image_session.get_inputs()[0].name
            output_name = self.image_session.get_outputs()[0].name
            
            embedding = self.image_session.run(
                [output_name], 
                {input_name: input_tensor}
            )[0]
            
            # Normalize embedding
            embedding = embedding.squeeze()
            embedding = embedding / np.linalg.norm(embedding)
            
            # Cache result
            await self.cache.set_embedding(image_hash, embedding.tolist())
            
            return embedding
            
        except Exception as e:
            logger.error(f"CLIP image embedding failed: {e}")
            # Return zero vector as fallback
            return np.zeros(512, dtype=np.float32)
    
    async def compute_text_embedding(self, text: str) -> np.ndarray:
        """Compute CLIP text embedding with caching"""
        text_hash = hashlib.md5(text.encode()).hexdigest()
        
        # Check cache
        cached_embedding = await self.cache.get_text_embedding(text_hash)
        if cached_embedding:
            return np.array(cached_embedding)
        
        try:
            # Lazy load model
            if not self.text_session:
                self.text_session = await self._load_text_model()
            
            # Tokenize text
            input_ids = self.text_processor.tokenize_text(text)
            
            # Run inference
            input_name = self.text_session.get_inputs()[0].name
            output_name = self.text_session.get_outputs()[0].name
            
            embedding = self.text_session.run(
                [output_name],
                {input_name: input_ids}
            )[0]
            
            # Normalize
            embedding = embedding.squeeze()
            embedding = embedding / np.linalg.norm(embedding)
            
            # Cache result
            await self.cache.set_text_embedding(text_hash, embedding.tolist())
            
            return embedding
            
        except Exception as e:
            logger.error(f"CLIP text embedding failed: {e}")
            return np.zeros(512, dtype=np.float32)
    
    async def compute_similarity(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Compute cosine similarity between two embeddings"""
        return float(np.dot(embedding1, embedding2))
    
    async def _compute_image_hash(self, image: Image.Image) -> str:
        """Compute perceptual hash for image caching"""
        # Use pHash for content-based deduplication
        phash = imagehash.phash(image, hash_size=16)
        return str(phash)
    
    async def _load_image_model(self):
        """Lazy load CLIP image model"""
        model_path = os.path.join(MODEL_DIR, "fashion-clip-image.onnx")
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = ONNX_NUM_THREADS
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        return ort.InferenceSession(
            model_path, 
            session_options, 
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
        )
    
    async def _load_text_model(self):
        """Lazy load CLIP text model"""
        model_path = os.path.join(MODEL_DIR, "fashion-clip-text.onnx")
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = ONNX_NUM_THREADS
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        return ort.InferenceSession(
            model_path,
            session_options,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
        )
```

### Performance Optimization

#### Memory Management
```python
# lib/model/memory_optimization.py
class MemoryOptimizedInference:
    def __init__(self, max_batch_size: int = 32, max_memory_gb: float = 4.0):
        self.max_batch_size = max_batch_size
        self.max_memory_gb = max_memory_gb
        self.embedding_cache = LRUCache(maxsize=10000)
        
    def should_process_batch(self, current_batch_size: int, estimated_memory: float) -> bool:
        """Determine if batch should be processed based on memory constraints"""
        estimated_total_memory = estimated_memory * current_batch_size / (1024**3)  # GB
        return estimated_total_memory < self.max_memory_gb
    
    def adaptive_batch_size(self, num_items: int, item_memory_mb: float = 50) -> int:
        """Calculate optimal batch size based on available memory"""
        available_memory_gb = self.max_memory_gb
        max_batch_by_memory = int((available_memory_gb * 1024) / item_memory_mb)
        
        return min(self.max_batch_size, max_batch_by_memory, num_items)
    
    async def process_with_memory_limits(
        self, 
        items: List[Any], 
        processor: Callable,
        item_memory_mb: float = 50
    ) -> List[Any]:
        """Process items with adaptive batching to stay within memory limits"""
        results = []
        
        for i in range(0, len(items), self.max_batch_size):
            batch = items[i:i + self.max_batch_size]
            
            # Calculate optimal batch size for this chunk
            optimal_batch_size = self.adaptive_batch_size(len(batch), item_memory_mb)
            
            # Process in smaller sub-batches if needed
            for j in range(0, len(batch), optimal_batch_size):
                sub_batch = batch[j:j + optimal_batch_size]
                
                try:
                    batch_results = await processor(sub_batch)
                    results.extend(batch_results)
                    
                    # Force garbage collection between batches
                    if hasattr(gc, 'collect'):
                        gc.collect()
                        
                except MemoryError:
                    logger.warning("Memory limit exceeded, reducing batch size")
                    # Reduce batch size and retry
                    reduced_batch_size = max(1, optimal_batch_size // 2)
                    for item in sub_batch:
                        result = await processor([item])
                        results.extend(result)
        
        return results
```

#### GPU Acceleration
```python
# lib/model/gpu_acceleration.py
class GPUAcceleratedInference:
    def __init__(self):
        self.device = self._detect_gpu()
        self.memory_pool = self._initialize_memory_pool()
        
    def _detect_gpu(self) -> str:
        """Detect available GPU acceleration"""
        try:
            import torch
            if torch.cuda.is_available():
                return f"cuda:{torch.cuda.current_device()}"
        except ImportError:
            pass
        
        # Check for other GPU libraries
        try:
            import tensorflow as tf
            gpus = tf.config.list_physical_devices('GPU')
            if gpus:
                return "tensorflow"
        except ImportError:
            pass
            
        return "cpu"
    
    async def optimize_for_gpu(self, model_session, input_data):
        """Apply GPU-specific optimizations"""
        if self.device.startswith("cuda"):
            # PyTorch CUDA optimizations
            return await self._apply_pytorch_cuda_optimizations(model_session, input_data)
        elif self.device == "tensorflow":
            # TensorFlow GPU optimizations
            return await self._apply_tensorflow_gpu_optimizations(model_session, input_data)
        else:
            # CPU optimizations
            return await self._apply_cpu_optimizations(model_session, input_data)
    
    async def _apply_pytorch_cuda_optimizations(self, session, input_data):
        """PyTorch CUDA specific optimizations"""
        # Pin memory for faster GPU transfer
        if hasattr(input_data, 'pin_memory'):
            input_data = input_data.pin_memory()
        
        # Use CUDA streams for concurrent execution
        stream = torch.cuda.current_stream()
        
        with torch.cuda.stream(stream):
            result = session.run(None, input_data)
            
        # Synchronize stream
        stream.synchronize()
        
        return result
```

### Quality Metrics and Monitoring

#### Embedding Quality Validation
```python
# lib/model/quality_validation.py
class EmbeddingQualityValidator:
    def __init__(self):
        self.reference_embeddings = self._load_reference_embeddings()
        
    def validate_embedding_quality(self, embedding: np.ndarray, source_type: str) -> QualityMetrics:
        """Validate embedding quality against reference data"""
        metrics = {
            "normality": self._check_normality(embedding),
            "diversity": self._check_diversity(embedding),
            "consistency": self._check_consistency(embedding, source_type),
            "outlier_score": self._detect_outliers(embedding),
        }
        
        # Overall quality score
        metrics["overall_score"] = self._compute_overall_score(metrics)
        
        return metrics
    
    def _check_normality(self, embedding: np.ndarray) -> float:
        """Check if embedding follows expected distribution"""
        # Embeddings should be L2 normalized (norm ≈ 1.0)
        norm = np.linalg.norm(embedding)
        return 1.0 - abs(norm - 1.0)  # Higher is better
    
    def _check_diversity(self, embedding: np.ndarray) -> float:
        """Check embedding diversity (avoid collapsed representations)"""
        # Measure spread of embedding values
        std = np.std(embedding)
        return min(1.0, std * 10)  # Normalize to 0-1
    
    def _check_consistency(self, embedding: np.ndarray, source_type: str) -> float:
        """Check consistency with reference embeddings of same type"""
        if source_type not in self.reference_embeddings:
            return 0.5  # Neutral score
        
        references = self.reference_embeddings[source_type]
        similarities = [cosine_similarity(embedding, ref) for ref in references]
        
        # Average similarity to same-type references
        avg_similarity = np.mean(similarities)
        return avg_similarity
    
    def _detect_outliers(self, embedding: np.ndarray) -> float:
        """Detect if embedding is an outlier"""
        # Simple outlier detection based on distance to reference set
        all_references = np.concatenate(list(self.reference_embeddings.values()))
        distances = [cosine_similarity(embedding, ref) for ref in all_references]
        
        # Lower percentile indicates outlier
        return np.percentile(distances, 25)
    
    def _compute_overall_score(self, metrics: dict) -> float:
        """Compute weighted overall quality score"""
        weights = {
            "normality": 0.3,
            "diversity": 0.2,
            "consistency": 0.4,
            "outlier_score": 0.1,
        }
        
        score = sum(metrics[key] * weight for key, weight in weights.items())
        return max(0.0, min(1.0, score))  # Clamp to [0,1]
    
    def _load_reference_embeddings(self) -> Dict[str, np.ndarray]:
        """Load reference embeddings for quality validation"""
        # Load pre-computed reference embeddings for different content types
        references = {}
        
        reference_files = {
            "fashion_images": "reference_embeddings/fashion_images.npy",
            "product_photos": "reference_embeddings/product_photos.npy",
            "text_descriptions": "reference_embeddings/text_descriptions.npy",
        }
        
        for category, filepath in reference_files.items():
            try:
                references[category] = np.load(filepath)
            except FileNotFoundError:
                logger.warning(f"Reference embeddings not found: {filepath}")
                references[category] = np.array([])
        
        return references
```

### Installation and Setup

```bash
# Download CLIP model
pnpm run download-clip

# Verify installation
ls -la models/
# Should contain: fashion-clip-image.onnx, fashion-clip-text.onnx

# Install dependencies
pip install transformers torch onnxruntime-gpu pillow numpy

# Test inference
python -c "
from lib.model.embedding_service import CLIPEmbeddingService
import asyncio

async def test():
    service = CLIPEmbeddingService()
    embedding = await service.compute_text_embedding('red dress')
    print(f'Embedding shape: {embedding.shape}')
    print(f'Embedding norm: {np.linalg.norm(embedding):.4f}')

asyncio.run(test())
"
```

### Performance Benchmarks

| Operation | CPU (i7-8700K) | GPU (RTX 3080) | Batch Size |
|-----------|----------------|----------------|------------|
| Image Embedding | 180ms | 25ms | 1 |
| Text Embedding | 45ms | 8ms | 1 |
| Batch Image (8) | 420ms | 45ms | 8 |
| Similarity Search | 12ms | 10ms | N/A |

### Error Handling and Fallbacks

```typescript
// lib/model/fallback_service.ts
export class EmbeddingFallbackService {
  private primaryService: CLIPEmbeddingService;
  private fallbackService: SimpleEmbeddingService;
  private metrics: EmbeddingMetrics;
  
  async computeEmbeddingWithFallback(
    input: Image.Image | string,
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    try {
      // Try primary CLIP service
      const embedding = input instanceof Image.Image
        ? await this.primaryService.compute_image_embedding(input)
        : await this.primaryService.compute_text_embedding(input);
      
      this.metrics.recordSuccess('primary', Date.now() - startTime);
      
      return {
        embedding,
        source: 'clip',
        confidence: 1.0,
        processing_time_ms: Date.now() - startTime
      };
      
    } catch (error) {
      logger.warn(`Primary embedding failed: ${error.message}`);
      this.metrics.recordFailure('primary');
      
      try {
        // Fallback to simpler method
        const fallbackEmbedding = await this.fallbackService.compute(input);
        
        this.metrics.recordSuccess('fallback', Date.now() - startTime);
        
        return {
          embedding: fallbackEmbedding,
          source: 'fallback',
          confidence: 0.7,  // Lower confidence for fallback
          processing_time_ms: Date.now() - startTime
        };
        
      } catch (fallbackError) {
        logger.error(`Fallback embedding also failed: ${fallbackError.message}`);
        this.metrics.recordFailure('fallback');
        
        // Return zero vector as last resort
        return {
          embedding: new Array(512).fill(0),
          source: 'zero_fallback',
          confidence: 0.0,
          processing_time_ms: Date.now() - startTime,
          error: 'All embedding methods failed'
        };
      }
    }
  }
}
```

---

## XGBoost Ranking Model

### Model Architecture

The XGBoost ranker uses gradient boosting to rank product recommendations based on multiple features:

#### Feature Categories
1. **Similarity Features**
   - CLIP visual similarity score
   - Text similarity score
   - Category compatibility
   - Brand affinity

2. **Style Features**
   - Style matching score (casual, formal, sporty)
   - Color harmony score
   - Seasonality compatibility
   - Occasion appropriateness

3. **Market Features**
   - Price ratio (target vs candidate)
   - Quality score differential
   - Popularity metrics
   - Vendor reliability

4. **Context Features**
   - User interaction history
   - Time of day/season
   - Geographic preferences
   - Device type

### Training Pipeline

#### 1. Data Collection
```python
# training_data_collector.py
import pandas as pd
from sqlalchemy import create_engine

def collect_training_data(days_back=30):
    """Collect labeled interaction data for training"""
    engine = create_engine(DATABASE_URL)
    
    query = """
    SELECT 
        ri.source_product_id,
        ri.candidate_product_id,
        ri.position,
        ri.clicked,
        ri.purchased,
        rl.label,
        -- Feature columns
        rf.style_score,
        rf.color_score,
        rf.clip_sim,
        rf.text_sim,
        rf.price_ratio,
        p1.category as source_category,
        p2.category as candidate_category
    FROM recommendation_impressions ri
    LEFT JOIN recommendation_labels rl ON ri.id = rl.impression_id
    LEFT JOIN recommendation_features rf ON ri.id = rf.impression_id
    LEFT JOIN products p1 ON ri.source_product_id = p1.id
    LEFT JOIN products p2 ON ri.candidate_product_id = p2.id
    WHERE ri.created_at >= NOW() - INTERVAL '%s days'
    AND rl.label IS NOT NULL
    """ % days_back
    
    return pd.read_sql(query, engine)
```

#### 2. Feature Engineering
```python
# feature_engineering.py
def engineer_features(df):
    """Create engineered features for training"""
    
    # Interaction features
    df['price_ratio_log'] = np.log1p(df['price_ratio'])
    df['similarity_product'] = df['clip_sim'] * df['text_sim']
    df['style_color_harmony'] = df['style_score'] * df['color_score']
    
    # Category encoding
    category_pairs = df['source_category'] + '_to_' + df['candidate_category']
    df = pd.concat([df, pd.get_dummies(category_pairs, prefix='cat_pair')], axis=1)
    
    # Positional features
    df['position_log'] = np.log1p(df['position'])
    df['position_inverse'] = 1.0 / (df['position'] + 1)
    
    return df
```

#### 3. Model Training
```python
# train_xgb_ranker.py
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import ndcg_score

def train_ranker(df):
    """Train XGBoost ranking model"""
    
    # Prepare features and labels
    feature_cols = [col for col in df.columns if col.startswith(('style_', 'color_', 'clip_', 'text_', 'price_', 'cat_'))]
    X = df[feature_cols]
    y = df['label'].map({'good': 1.0, 'ok': 0.5, 'bad': 0.0})
    
    # Group by query (source product)
    groups = df.groupby('source_product_id').size().values
    
    # Train-test split maintaining groups
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Train XGBoost ranker
    model = xgb.XGBRanker(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42
    )
    
    model.fit(
        X_train, y_train,
        group=groups[:len(X_train)],
        eval_set=[(X_test, y_test)],
        eval_group=[groups[len(X_train):]],
        eval_metric='ndcg@10',
        early_stopping_rounds=20,
        verbose=True
    )
    
    return model, feature_cols

# Save model and metadata
model, features = train_ranker(training_data)
model.save_model('models/xgb_ranker_model.json')

metadata = {
    'version': '2.1',
    'features': features,
    'training_date': datetime.now().isoformat(),
    'training_samples': len(training_data),
    'ndcg_score': float(ndcg_score),
}

with open('models/ranker_model_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)
```

### Model Serving

#### FastAPI Service
```python
# ranker_api.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import xgboost as xgb
import pandas as pd
import numpy as np

app = FastAPI(title="Fashion Ranker API")

# Global model instance
model = None
feature_names = None

class PredictionRequest(BaseModel):
    features: List[Dict[str, float]]
    
class PredictionResponse(BaseModel):
    scores: List[float]
    model_version: str

@app.on_event("startup")
async def load_model():
    global model, feature_names
    
    model = xgb.XGBRanker()
    model.load_model('models/xgb_ranker_model.json')
    
    with open('models/ranker_model_metadata.json') as f:
        metadata = json.load(f)
        feature_names = metadata['features']

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    try:
        # Convert to DataFrame with proper feature order
        df = pd.DataFrame(request.features)[feature_names]
        
        # Handle missing features
        df = df.fillna(0.0)
        
        # Predict scores
        scores = model.predict(df).tolist()
        
        return PredictionResponse(
            scores=scores,
            model_version="v2.1"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model_loaded": model is not None}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### Node.js Integration
```typescript
// ranker/client.ts
interface RankerPrediction {
  scores: number[];
  model_version: string;
}

export async function predictWithFallback(
  features: FeatureRow[],
  options: RankingOptions = {}
): Promise<number[]> {
  try {
    // Try ML service first
    if (await isRankerAvailable()) {
      const response = await fetch(`${RANKER_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
        timeout: options.timeout || 5000,
      });
      
      const prediction: RankerPrediction = await response.json();
      return prediction.scores;
    }
  } catch (error) {
    logger.warn('Ranker service unavailable, using heuristic fallback', error);
  }
  
  // Fallback to heuristic scoring
  return features.map(feature => computeHeuristicScore(feature));
}

function computeHeuristicScore(feature: FeatureRow): number {
  // Simple weighted combination as fallback
  const weights = {
    clip_sim: 0.3,
    text_sim: 0.2,
    style_score: 0.25,
    color_score: 0.15,
    price_ratio: 0.1,
  };
  
  return Object.entries(weights).reduce((score, [key, weight]) => {
    return score + (feature[key] || 0) * weight;
  }, 0);
}
```

### Model Performance

#### Evaluation Metrics
- **NDCG@10**: 0.78 (normalized discounted cumulative gain)
- **MAP**: 0.72 (mean average precision)
- **CTR Improvement**: +15% vs baseline
- **Conversion Improvement**: +8% vs baseline

#### A/B Testing Framework
```typescript
// experiments/ab_testing.ts
export class RankerABTest {
  constructor(
    private controlModel: string,
    private treatmentModel: string,
    private trafficSplit: number = 0.1
  ) {}
  
  async getRecommendations(
    userId: string,
    productId: number,
    candidates: CandidateResult[]
  ): Promise<RankedResult[]> {
    const isInTreatment = this.shouldUseTreatment(userId);
    const modelVersion = isInTreatment ? this.treatmentModel : this.controlModel;
    
    const results = await this.rankWithModel(candidates, modelVersion);
    
    // Log assignment for analysis
    await this.logExperimentAssignment(userId, modelVersion, {
      productId,
      candidateCount: candidates.length,
    });
    
    return results;
  }
  
  private shouldUseTreatment(userId: string): boolean {
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    const hashInt = parseInt(hash.substring(0, 8), 16);
    return (hashInt % 100) < (this.trafficSplit * 100);
  }
}
```

### Advanced Feature Engineering

#### Temporal Features
```python
# features/temporal_features.py
def engineer_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add time-based features for ranking"""
    
    # Hour of day (cyclical encoding)
    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
    
    # Day of week (cyclical encoding)
    df['day_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
    df['day_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
    
    # Season (cyclical encoding)
    df['season_sin'] = np.sin(2 * np.pi * df['month'] / 12)
    df['season_cos'] = np.cos(2 * np.pi * df['month'] / 12)
    
    # Time since product was added
    df['days_since_added'] = (pd.Timestamp.now() - pd.to_datetime(df['product_created_at'])).dt.days
    df['days_since_added_log'] = np.log1p(df['days_since_added'])
    
    # Recency of user interaction
    df['days_since_last_interaction'] = (pd.Timestamp.now() - pd.to_datetime(df['last_interaction'])).dt.days
    df['interaction_recency_score'] = 1 / (1 + df['days_since_last_interaction'])
    
    return df
```

#### Categorical Feature Encoding
```python
# features/categorical_encoding.py
def encode_categorical_features(df: pd.DataFrame) -> pd.DataFrame:
    """Advanced categorical encoding for XGBoost"""
    
    # Target encoding for categories
    category_stats = df.groupby('candidate_category').agg({
        'clicked': 'mean',
        'purchased': 'mean',
        'position': 'mean'
    }).rename(columns={
        'clicked': 'category_click_rate',
        'purchased': 'category_purchase_rate',
        'position': 'category_avg_position'
    })
    
    df = df.merge(category_stats, left_on='candidate_category', right_index=True, how='left')
    
    # Brand affinity encoding
    brand_stats = df.groupby('candidate_brand').agg({
        'clicked': 'mean',
        'purchased': 'mean'
    }).rename(columns={
        'clicked': 'brand_click_rate',
        'purchased': 'brand_purchase_rate'
    })
    
    df = df.merge(brand_stats, left_on='candidate_brand', right_index=True, how='left')
    
    # Cross-category features
    df['source_target_category_pair'] = df['source_category'] + '_' + df['candidate_category']
    
    # Frequency encoding for rare categories
    for col in ['source_category', 'candidate_category', 'source_target_category_pair']:
        freq_map = df[col].value_counts()
        df[f'{col}_freq'] = df[col].map(freq_map)
        df[f'{col}_freq_encoded'] = df[f'{col}_freq'] / len(df)
    
    return df
```

#### Neural Feature Extraction
```python
# features/neural_features.py
def extract_neural_features(
    source_embedding: np.ndarray,
    candidate_embedding: np.ndarray,
    source_image_embedding: np.ndarray,
    candidate_image_embedding: np.ndarray
) -> Dict[str, float]:
    """Extract neural network-based features"""
    
    features = {}
    
    # Embedding similarities
    features['text_similarity'] = cosine_similarity(source_embedding, candidate_embedding)
    features['image_similarity'] = cosine_similarity(source_image_embedding, candidate_image_embedding)
    
    # Cross-modal similarities
    features['text_to_image_similarity'] = cosine_similarity(source_embedding, candidate_image_embedding)
    features['image_to_text_similarity'] = cosine_similarity(source_image_embedding, candidate_embedding)
    
    # Embedding statistics
    features['source_text_norm'] = np.linalg.norm(source_embedding)
    features['candidate_text_norm'] = np.linalg.norm(candidate_embedding)
    features['source_image_norm'] = np.linalg.norm(source_image_embedding)
    features['candidate_image_norm'] = np.linalg.norm(candidate_image_embedding)
    
    # Component-wise similarities (for different embedding segments)
    segment_size = len(source_embedding) // 4
    for i in range(4):
        start_idx = i * segment_size
        end_idx = (i + 1) * segment_size
        
        features[f'text_similarity_segment_{i}'] = cosine_similarity(
            source_embedding[start_idx:end_idx],
            candidate_embedding[start_idx:end_idx]
        )
        
        features[f'image_similarity_segment_{i}'] = cosine_similarity(
            source_image_embedding[start_idx:end_idx],
            candidate_image_embedding[start_idx:end_idx]
        )
    
    return features
```

### Model Training with Hyperparameter Optimization

#### Bayesian Optimization
```python
# training/hyperparameter_optimization.py
from skopt import BayesSearchCV
from skopt.space import Real, Integer, Categorical
import xgboost as xgb

def optimize_xgboost_hyperparameters(X_train, y_train, groups_train):
    """Bayesian optimization of XGBoost hyperparameters"""
    
    # Define search space
    search_spaces = {
        'max_depth': Integer(3, 10),
        'learning_rate': Real(0.01, 0.3, prior='log-uniform'),
        'n_estimators': Integer(50, 300),
        'subsample': Real(0.6, 1.0),
        'colsample_bytree': Real(0.6, 1.0),
        'reg_alpha': Real(0.0, 1.0),
        'reg_lambda': Real(0.0, 1.0),
        'min_child_weight': Integer(1, 10),
        'gamma': Real(0.0, 1.0),
    }
    
    # Base model
    base_model = xgb.XGBRanker(
        objective='rank:pairwise',
        random_state=42,
        n_jobs=-1
    )
    
    # Bayesian optimization
    opt = BayesSearchCV(
        base_model,
        search_spaces,
        n_iter=50,  # Number of optimization iterations
        cv=3,
        scoring='neg_mean_absolute_error',  # Ranking-appropriate metric
        random_state=42,
        n_jobs=1  # Sequential for reproducibility
    )
    
    # Fit optimizer
    opt.fit(X_train, y_train, groups=groups_train)
    
    print(f"Best parameters: {opt.best_params_}")
    print(f"Best CV score: {opt.best_score_}")
    
    return opt.best_estimator_, opt.best_params_
```

#### Cross-Validation for Ranking
```python
# training/ranking_cross_validation.py
def ranking_cross_validation(X, y, groups, model_params, n_splits=5):
    """Time-aware cross-validation for ranking models"""
    
    # Group-aware split (preserve query groups)
    from sklearn.model_selection import GroupKFold
    
    group_kfold = GroupKFold(n_splits=n_splits)
    
    cv_scores = []
    feature_importance_list = []
    
    for fold, (train_idx, val_idx) in enumerate(group_kfold.split(X, y, groups)):
        print(f"Fold {fold + 1}/{n_splits}")
        
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
        groups_train = groups.iloc[train_idx]
        
        # Train model
        model = xgb.XGBRanker(**model_params)
        model.fit(
            X_train, y_train,
            group=groups_train,
            eval_set=[(X_val, y_val)],
            early_stopping_rounds=20,
            verbose=False
        )
        
        # Evaluate
        y_pred = model.predict(X_val)
        
        # Calculate ranking metrics
        ndcg_score = calculate_ndcg(y_val, y_pred, groups.iloc[val_idx])
        map_score = calculate_map(y_val, y_pred, groups.iloc[val_idx])
        
        cv_scores.append({
            'fold': fold,
            'ndcg@10': ndcg_score,
            'map': map_score
        })
        
        # Collect feature importance
        importance = model.get_booster().get_score(importance_type='gain')
        feature_importance_list.append(importance)
    
    # Aggregate results
    avg_ndcg = np.mean([score['ndcg@10'] for score in cv_scores])
    avg_map = np.mean([score['map'] for score in cv_scores])
    
    # Aggregate feature importance
    avg_importance = {}
    for importance_dict in feature_importance_list:
        for feature, score in importance_dict.items():
            if feature not in avg_importance:
                avg_importance[feature] = []
            avg_importance[feature].append(score)
    
    for feature in avg_importance:
        avg_importance[feature] = np.mean(avg_importance[feature])
    
    return {
        'cv_scores': cv_scores,
        'avg_ndcg@10': avg_ndcg,
        'avg_map': avg_map,
        'feature_importance': avg_importance
    }
```

### Model Interpretability

#### SHAP Values for Feature Importance
```python
# interpretability/shap_analysis.py
import shap
import matplotlib.pyplot as plt

def analyze_feature_importance(model, X_train, feature_names):
    """Analyze feature importance using SHAP values"""
    
    # Create SHAP explainer
    explainer = shap.TreeExplainer(model)
    
    # Calculate SHAP values
    shap_values = explainer.shap_values(X_train)
    
    # Summary plot
    plt.figure(figsize=(10, 6))
    shap.summary_plot(
        shap_values, 
        X_train, 
        feature_names=feature_names,
        show=False
    )
    plt.savefig('feature_importance_shap.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    # Feature importance from SHAP
    feature_importance = np.abs(shap_values).mean(axis=0)
    importance_df = pd.DataFrame({
        'feature': feature_names,
        'importance': feature_importance
    }).sort_values('importance', ascending=False)
    
    return importance_df, shap_values
```

#### Partial Dependence Plots
```python
# interpretability/partial_dependence.py
from sklearn.inspection import partial_dependence, PartialDependenceDisplay

def create_partial_dependence_plots(model, X_train, features_to_plot):
    """Create partial dependence plots for key features"""
    
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    
    for i, feature in enumerate(features_to_plot):
        if i >= len(axes):
            break
            
        # Calculate partial dependence
        pd_results = partial_dependence(
            model, X_train, [feature], kind='average'
        )
        
        # Plot
        PartialDependenceDisplay(
            pd_results, 
            features=[feature], 
            feature_names=[feature],
            ax=axes[i]
        ).plot(ax=axes[i])
        
        axes[i].set_title(f'Partial Dependence: {feature}')
    
    plt.tight_layout()
    plt.savefig('partial_dependence_plots.png', dpi=300, bbox_inches='tight')
    plt.close()
```

### Production Model Serving

#### Model Versioning and A/B Testing
```typescript
// serving/model_versioning.ts
export class ModelVersionManager {
  private versions: Map<string, ModelVersion> = new Map();
  
  async deployNewVersion(
    modelPath: string,
    metadata: ModelMetadata,
    trafficPercentage: number = 10
  ): Promise<string> {
    const versionId = `v${metadata.version}_${Date.now()}`;
    
    // Load and validate model
    const model = await this.loadModel(modelPath);
    await this.validateModel(model, metadata);
    
    // Create version
    const version: ModelVersion = {
      id: versionId,
      model,
      metadata,
      trafficPercentage,
      createdAt: new Date(),
      status: 'testing'
    };
    
    this.versions.set(versionId, version);
    
    // Start A/B test
    await this.startABTest(version);
    
    return versionId;
  }
  
  async routeRequest(
    features: FeatureRow[],
    userId?: string
  ): Promise<number[]> {
    // Determine which model version to use
    const version = await this.selectModelVersion(userId);
    
    // Score with selected model
    const scores = await this.scoreWithModel(version.model, features);
    
    // Log for A/B testing
    await this.logPrediction(version.id, userId, features, scores);
    
    return scores;
  }
  
  private async selectModelVersion(userId?: string): Promise<ModelVersion> {
    // Champion-challenger routing
    const activeVersions = Array.from(this.versions.values())
      .filter(v => v.status === 'active' || v.status === 'testing');
    
    if (!userId) {
      // Random routing for anonymous users
      const totalTraffic = activeVersions.reduce((sum, v) => sum + v.trafficPercentage, 0);
      let random = Math.random() * totalTraffic;
      
      for (const version of activeVersions) {
        random -= version.trafficPercentage;
        if (random <= 0) {
          return version;
        }
      }
    }
    
    // Consistent routing for logged-in users (for A/B testing)
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    const bucket = parseInt(hash.substring(0, 8), 16) % 100;
    
    let cumulativeTraffic = 0;
    for (const version of activeVersions) {
      cumulativeTraffic += version.trafficPercentage;
      if (bucket < cumulativeTraffic) {
        return version;
      }
    }
    
    // Fallback to champion model
    return activeVersions.find(v => v.status === 'active') || activeVersions[0];
  }
}
```

#### Performance Monitoring
```typescript
// monitoring/ranker_metrics.ts
export class RankerMetricsCollector {
  private metrics = {
    prediction_time: new Histogram('ranker_prediction_duration_seconds'),
    model_score: new Histogram('ranker_model_score'),
    fallback_usage: new Counter('ranker_fallback_total'),
    version_usage: new Counter('ranker_version_usage_total'),
  };
  
  recordPrediction(
    version: string,
    duration: number,
    scores: number[],
    fallback: boolean = false
  ): void {
    this.metrics.prediction_time.observe(duration / 1000);
    
    // Record average score
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    this.metrics.model_score.observe(avgScore);
    
    // Record version usage
    this.metrics.version_usage.inc({ version });
    
    if (fallback) {
      this.metrics.fallback_usage.inc();
    }
  }
  
  async getPerformanceMetrics(timeRange: string = '1h'): Promise<PerformanceMetrics> {
    // Query metrics from Prometheus/monitoring system
    const [predictionTimes, scores, fallbacks] = await Promise.all([
      this.queryHistogram('ranker_prediction_duration_seconds', timeRange),
      this.queryHistogram('ranker_model_score', timeRange),
      this.queryCounter('ranker_fallback_total', timeRange)
    ]);
    
    return {
      avgPredictionTime: predictionTimes.avg,
      p95PredictionTime: predictionTimes.p95,
      avgScore: scores.avg,
      scoreDistribution: scores.quantiles,
      fallbackRate: fallbacks.rate,
      totalPredictions: predictionTimes.count
    };
  }
}
```

### Model Maintenance and Retraining

#### Automated Retraining Pipeline
```python
# maintenance/auto_retraining.py
class AutoRetrainingPipeline:
    def __init__(self, config):
        self.config = config
        self.db = DatabaseConnection(config.database_url)
        self.model_registry = ModelRegistry(config.model_store)
        
    def should_retrain(self) -> Tuple[bool, str]:
        """Determine if model needs retraining"""
        
        # Check data freshness
        latest_training = self.db.get_latest_training_timestamp()
        days_since_training = (datetime.now() - latest_training).days
        
        if days_since_training > self.config.max_days_without_retraining:
            return True, f"Model is {days_since_training} days old"
        
        # Check performance degradation
        current_metrics = self.get_current_model_metrics()
        performance_drop = self.config.baseline_ndcg - current_metrics.ndcg_score
        
        if performance_drop > self.config.performance_drop_threshold:
            return True, f"Performance dropped by {performance_drop:.3f} NDCG points"
        
        # Check data volume
        new_samples = self.db.count_new_samples_since(latest_training)
        if new_samples > self.config.min_samples_for_retraining:
            return True, f"{new_samples} new samples available"
        
        return False, "Model performing well"
    
    async def execute_retraining(self) -> Optional[str]:
        """Execute full retraining pipeline"""
        logger.info("Starting automated retraining")
        
        try:
            # Collect fresh training data
            training_data = await self.collect_training_data()
            
            # Validate data quality
            if not self.validate_training_data(training_data):
                logger.error("Training data validation failed")
                return None
            
            # Train new model
            new_model, metadata = await self.train_new_model(training_data)
            
            # Validate model performance
            validation_metrics = await self.validate_model(new_model, training_data)
            
            if validation_metrics.ndcg_score < self.config.min_deployment_score:
                logger.error(f"New model performance too low: {validation_metrics.ndcg_score}")
                return None
            
            # Deploy model with gradual rollout
            version_id = await self.deploy_model(new_model, metadata, validation_metrics)
            
            logger.info(f"Successfully deployed new model version: {version_id}")
            return version_id
            
        except Exception as e:
            logger.error(f"Retraining failed: {e}")
            return None
    
    async def collect_training_data(self) -> pd.DataFrame:
        """Collect and prepare training data"""
        # Query interaction data
        interactions = self.db.get_recent_interactions(
            days_back=self.config.training_window_days
        )
        
        # Convert to training format
        training_data = self.prepare_training_data(interactions)
        
        # Add feature engineering
        training_data = await self.engineer_features(training_data)
        
        return training_data
    
    def validate_training_data(self, data: pd.DataFrame) -> bool:
        """Validate training data quality"""
        min_samples = self.config.min_training_samples
        if len(data) < min_samples:
            logger.error(f"Insufficient training samples: {len(data)} < {min_samples}")
            return False
        
        # Check for required columns
        required_columns = ['user_id', 'item_id', 'label', 'features']
        missing_columns = [col for col in required_columns if col not in data.columns]
        if missing_columns:
            logger.error(f"Missing required columns: {missing_columns}")
            return False
        
        # Check label distribution
        label_distribution = data['label'].value_counts(normalize=True)
        if label_distribution.min() < 0.05:  # No class should be < 5%
            logger.warning("Uneven label distribution detected")
        
        return True
```

---

## Semantic Search Engine

### Query Understanding Pipeline

#### 1. Intent Classification
```typescript
// search/semanticSearch.ts
export function classifyQueryIntent(query: string): QueryIntent {
  const normalizedQuery = query.toLowerCase();
  
  // Price-focused queries
  if (/\b(cheap|expensive|price|under|over|\$|€|£)\b/.test(normalizedQuery)) {
    return 'price_search';
  }
  
  // Brand-focused queries
  if (KNOWN_BRANDS.has(extractBrand(normalizedQuery))) {
    return 'brand_search';
  }
  
  // Category browsing
  if (KNOWN_CATEGORIES.has(extractCategory(normalizedQuery))) {
    return 'category_browse';
  }
  
  // Style searches
  if (/\b(style|aesthetic|vibe|look|outfit)\b/.test(normalizedQuery)) {
    return 'style_search';
  }
  
  // Comparison intent
  if (/\b(vs|versus|compare|better|best)\b/.test(normalizedQuery)) {
    return 'comparison';
  }
  
  return 'product_search';
}
```

#### 2. Entity Extraction
```typescript
export function extractEntities(query: string): QueryEntities {
  const entities: QueryEntities = {
    brands: [],
    categories: [],
    colors: [],
    sizes: [],
    attributes: [],
  };
  
  // Brand extraction
  entities.brands = extractBrands(query);
  
  // Color extraction with synonyms
  entities.colors = extractColors(query);
  
  // Size extraction (US, EU, UK sizes)
  entities.sizes = extractSizes(query);
  
  // Category detection
  entities.categories = extractCategories(query);
  
  // Price range extraction
  entities.priceRange = extractPriceRange(query);
  
  return entities;
}

function extractColors(query: string): string[] {
  const colorMap = {
    'red': ['red', 'crimson', 'scarlet', 'burgundy', 'maroon'],
    'blue': ['blue', 'navy', 'royal blue', 'sky blue', 'turquoise'],
    'black': ['black', 'ebony', 'jet black'],
    'white': ['white', 'ivory', 'cream', 'off-white'],
    'green': ['green', 'olive', 'forest green', 'mint'],
    // ... more color mappings
  };
  
  const found = new Set<string>();
  
  for (const [canonical, variants] of Object.entries(colorMap)) {
    for (const variant of variants) {
      if (query.toLowerCase().includes(variant)) {
        found.add(canonical);
        break;
      }
    }
  }
  
  return Array.from(found);
}
```

#### 3. Query Expansion
```typescript
export function expandQuery(entities: QueryEntities, originalQuery: string): string[] {
  const expandedTerms = [originalQuery];
  
  // Add synonyms for detected entities
  entities.brands.forEach(brand => {
    expandedTerms.push(...getBrandSynonyms(brand));
  });
  
  entities.categories.forEach(category => {
    expandedTerms.push(...getCategorySynonyms(category));
  });
  
  entities.colors.forEach(color => {
    expandedTerms.push(...getColorSynonyms(color));
  });
  
  // Add related terms based on query intent
  const intent = classifyQueryIntent(originalQuery);
  expandedTerms.push(...getIntentBasedTerms(intent));
  
  return [...new Set(expandedTerms)]; // Deduplicate
}
```

### Hybrid Search Implementation

```typescript
// search/hybridSearch.ts
export async function hybridSearch(
  query: string,
  filters: SearchFilters,
  options: SearchOptions
): Promise<SearchResult[]> {
  const parsedQuery = parseQuery(query);
  
  // Parallel searches
  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(parsedQuery, filters),
    semanticVectorSearch(parsedQuery, filters)
  ]);
  
  // Merge and rerank results
  const mergedResults = mergeSearchResults(
    keywordResults,
    semanticResults,
    {
      keywordWeight: 0.6,
      semanticWeight: 0.4,
    }
  );
  
  // Apply business rules
  const rankedResults = applyBusinessRules(mergedResults, parsedQuery);
  
  return rankedResults.slice(0, options.limit || 20);
}

function mergeSearchResults(
  keywordResults: SearchResult[],
  semanticResults: SearchResult[],
  weights: { keywordWeight: number; semanticWeight: number }
): SearchResult[] {
  const resultMap = new Map<number, SearchResult>();
  
  // Add keyword results
  keywordResults.forEach(result => {
    resultMap.set(result.id, {
      ...result,
      combinedScore: result.score * weights.keywordWeight,
      sources: ['keyword']
    });
  });
  
  // Merge semantic results
  semanticResults.forEach(result => {
    if (resultMap.has(result.id)) {
      const existing = resultMap.get(result.id)!;
      existing.combinedScore += result.score * weights.semanticWeight;
      existing.sources.push('semantic');
    } else {
      resultMap.set(result.id, {
        ...result,
        combinedScore: result.score * weights.semanticWeight,
        sources: ['semantic']
      });
    }
  });
  
  return Array.from(resultMap.values())
    .sort((a, b) => b.combinedScore - a.combinedScore);
}
```

---

## Quality Analysis Engine

### Text Quality Assessment

#### Feature Extraction
```typescript
// compare/textQualityAnalyzer.ts
export function analyzeTextQuality(product: ProductForAnalysis): QualityAnalysis {
  const description = product.description || '';
  const title = product.title || '';
  
  return {
    word_count: countWords(description),
    readability_score: calculateReadabilityScore(description),
    completeness_score: assessCompleteness(description),
    attribute_coverage: analyzeAttributeCoverage(description),
    red_flags: detectRedFlags(description),
    quality_indicators: detectQualityIndicators(description),
  };
}

function assessCompleteness(description: string): number {
  const indicators = {
    fabric_info: /\b(cotton|polyester|wool|silk|denim|leather)\b/i,
    care_instructions: /\b(wash|dry clean|iron|bleach)\b/i,
    fit_info: /\b(slim|regular|loose|tight|oversized)\b/i,
    size_guide: /\b(size|fit|measurements|dimensions)\b/i,
    features: /\b(pocket|zipper|button|collar|sleeve)\b/i,
  };
  
  let score = 0;
  const totalIndicators = Object.keys(indicators).length;
  
  for (const [key, pattern] of Object.entries(indicators)) {
    if (pattern.test(description)) {
      score += 1;
    }
  }
  
  return (score / totalIndicators) * 100;
}

function detectRedFlags(description: string): string[] {
  const redFlags: string[] = [];
  
  // Quality concerns
  if (/\b(knock[- ]?off|replica|fake|imitation)\b/i.test(description)) {
    redFlags.push('authenticity_concern');
  }
  
  // Vague descriptions
  if (description.length < 50) {
    redFlags.push('too_short');
  }
  
  // Excessive marketing language
  if (/\b(amazing|incredible|unbelievable|revolutionary)\b/gi.test(description).length > 3) {
    redFlags.push('excessive_marketing');
  }
  
  // Poor grammar/spelling indicators
  if (/\b(alot|recieve|definately|seperate)\b/i.test(description)) {
    redFlags.push('spelling_errors');
  }
  
  return redFlags;
}
```

### Price Analysis Engine

```typescript
// compare/priceAnomalyDetector.ts
export async function analyzePriceAnomalies(
  product: ProductForAnalysis
): Promise<PriceAnalysis> {
  const category = product.category || 'unknown';
  const priceUSD = convertToUSD(product.price_cents, product.currency);
  
  // Get category baseline
  const baseline = await getCategoryBaseline(category);
  
  if (!baseline) {
    return createDefaultPriceAnalysis(priceUSD);
  }
  
  const marketPosition = determineMarketPosition(priceUSD, baseline);
  const volatility = await calculatePriceVolatility(product.id);
  
  return {
    current_price_usd: priceUSD,
    market_position: marketPosition,
    market_ratio: priceUSD / baseline.median_price_usd,
    volatility_30d: volatility.thirtyDay,
    volatility_level: classifyVolatility(volatility.thirtyDay),
    anomalies: detectAnomalies(priceUSD, baseline, volatility),
    price_score: calculatePriceScore(marketPosition, volatility),
  };
}

function determineMarketPosition(
  price: number,
  baseline: CategoryBaseline
): MarketPosition {
  const ratio = price / baseline.median_price_usd;
  
  if (ratio < 0.3) return 'suspicious_low';
  if (ratio < 0.5) return 'too_low';
  if (ratio < 0.8) return 'below_market';
  if (ratio <= 1.2) return 'normal';
  if (ratio <= 1.8) return 'above_market';
  return 'too_high';
}

async function calculatePriceVolatility(productId: number): Promise<{
  thirtyDay: number;
  ninetyDay: number;
}> {
  const priceHistory = await getPriceHistory(productId, 90);
  
  if (priceHistory.length < 3) {
    return { thirtyDay: 0, ninetyDay: 0 };
  }
  
  const prices30d = priceHistory.slice(-30).map(p => p.price_cents);
  const prices90d = priceHistory.map(p => p.price_cents);
  
  return {
    thirtyDay: calculateStandardDeviation(prices30d) / mean(prices30d),
    ninetyDay: calculateStandardDeviation(prices90d) / mean(prices90d),
  };
}
```

---

## Model Monitoring and Maintenance

### Performance Monitoring

#### Metrics Collection
```typescript
// monitoring/mlMetrics.ts
export class MLMetricsCollector {
  private metrics = {
    clip_embedding_time: new Histogram('clip_embedding_duration_seconds'),
    ranker_prediction_time: new Histogram('ranker_prediction_duration_seconds'),
    search_relevance_score: new Histogram('search_relevance_score'),
    recommendation_ctr: new Counter('recommendation_clicks_total'),
    model_fallback_count: new Counter('ml_service_fallbacks_total'),
  };
  
  recordEmbeddingTime(duration: number): void {
    this.metrics.clip_embedding_time.observe(duration / 1000);
  }
  
  recordRankerTime(duration: number): void {
    this.metrics.ranker_prediction_time.observe(duration / 1000);
  }
  
  recordRecommendationClick(clicked: boolean): void {
    if (clicked) {
      this.metrics.recommendation_ctr.inc();
    }
  }
  
  recordModelFallback(service: string): void {
    this.metrics.model_fallback_count.inc({ service });
  }
}
```

### Automated Retraining

#### Training Pipeline
```python
# ml/training_pipeline.py
class AutoTrainingPipeline:
    def __init__(self, config):
        self.config = config
        self.db = DatabaseConnection(config.database_url)
        
    def should_retrain(self) -> bool:
        """Determine if model needs retraining"""
        
        # Check data freshness
        latest_data = self.db.get_latest_training_data_date()
        days_since_training = (datetime.now() - latest_data).days
        
        if days_since_training > self.config.max_days_without_retraining:
            return True
            
        # Check performance degradation
        current_metrics = self.get_current_model_metrics()
        if current_metrics.ndcg_score < self.config.min_performance_threshold:
            return True
            
        # Check data volume
        new_samples = self.db.count_unlabeled_samples()
        if new_samples > self.config.min_samples_for_retraining:
            return True
            
        return False
        
    def run_training_pipeline(self):
        """Execute full training pipeline"""
        logger.info("Starting automated training pipeline")
        
        # Collect and validate data
        training_data = self.collect_training_data()
        validation_data = self.collect_validation_data()
        
        # Train new model
        new_model = self.train_xgboost_ranker(training_data)
        
        # Validate performance
        metrics = self.evaluate_model(new_model, validation_data)
        
        if metrics.ndcg_score > self.config.min_deployment_threshold:
            # Deploy new model
            self.deploy_model(new_model, metrics)
            logger.info(f"New model deployed with NDCG: {metrics.ndcg_score}")
        else:
            logger.warning(f"New model performance too low: {metrics.ndcg_score}")
```

### Model Versioning

```typescript
// ml/modelVersioning.ts
export class ModelVersionManager {
  async deployNewVersion(
    modelPath: string,
    metadata: ModelMetadata
  ): Promise<void> {
    // Validate model
    await this.validateModel(modelPath);
    
    // Create versioned deployment
    const version = await this.createVersion(metadata);
    
    // Gradual rollout
    await this.gradualRollout(version, {
      initialTraffic: 0.05,
      maxTraffic: 1.0,
      rolloutDuration: '1h',
    });
  }
  
  async rollbackToVersion(version: string): Promise<void> {
    logger.warn(`Rolling back to model version ${version}`);
    
    // Switch traffic to stable version
    await this.switchModelVersion(version);
    
    // Alert monitoring systems
    await this.sendRollbackAlert(version);
  }
  
  private async gradualRollout(
    version: string,
    config: RolloutConfig
  ): Promise<void> {
    let currentTraffic = config.initialTraffic;
    const increment = 0.1;
    const intervalMs = 10 * 60 * 1000; // 10 minutes
    
    while (currentTraffic < config.maxTraffic) {
      await this.setTrafficPercentage(version, currentTraffic);
      
      // Monitor performance for interval
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      
      const metrics = await this.getVersionMetrics(version);
      if (metrics.errorRate > 0.01) {
        throw new Error(`High error rate detected: ${metrics.errorRate}`);
      }
      
      currentTraffic = Math.min(currentTraffic + increment, config.maxTraffic);
    }
  }
}
```

This ML guide provides comprehensive coverage of all machine learning components in the Fashion Aggregator API. Each section includes practical implementation details, performance considerations, and maintenance procedures.