"""
ONNX Inference Module
Provides embedding generation using FashionCLIP and attribute extraction models
"""
import os
import numpy as np
from PIL import Image
import onnxruntime as ort
from typing import Optional, Dict, Any, List, Tuple
from transformers import CLIPTokenizer

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
ONNX_NUM_THREADS = int(os.environ.get("ONNX_NUM_THREADS", "4"))

# Session options for better performance
SESSION_OPTIONS = ort.SessionOptions()
SESSION_OPTIONS.intra_op_num_threads = ONNX_NUM_THREADS
SESSION_OPTIONS.inter_op_num_threads = ONNX_NUM_THREADS
SESSION_OPTIONS.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL


def get_execution_providers() -> List[str]:
    """
    Resolve ONNX Runtime execution providers in priority order.
    Default is GPU-first with CPU fallback for RTX deployments.
    """
    raw = os.environ.get("ONNX_EXECUTION_PROVIDERS", "").strip()
    if raw:
        providers = [p.strip() for p in raw.split(",") if p.strip()]
    else:
        providers = ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]

    alias_map = {
        "trt": "TensorrtExecutionProvider",
        "tensorrt": "TensorrtExecutionProvider",
        "cuda": "CUDAExecutionProvider",
        "cpu": "CPUExecutionProvider",
    }
    providers = [alias_map.get(p.lower(), p) for p in providers]

    available = set(ort.get_available_providers())
    selected = [p for p in providers if p in available]

    if not selected:
        selected = ["CPUExecutionProvider"] if "CPUExecutionProvider" in available else list(available)

    return selected


_execution_providers: Optional[List[str]] = None
_execution_provider_configs: Optional[List[Any]] = None


def current_execution_providers() -> List[str]:
    global _execution_providers
    if _execution_providers is None:
        _execution_providers = get_execution_providers()
        print(f"[ONNX] available_providers={ort.get_available_providers()}")
        print(f"[ONNX] selected_providers={_execution_providers}")
    return _execution_providers


def current_execution_provider_configs() -> List[Any]:
    """
    Build provider config list with TensorRT tuning knobs when available.
    """
    global _execution_provider_configs
    if _execution_provider_configs is not None:
        return _execution_provider_configs

    selected = current_execution_providers()
    configs: List[Any] = []
    trt_cache_path = os.environ.get("TRT_ENGINE_CACHE_PATH", "/tmp/trt_engine_cache")
    trt_enable_fp16 = os.environ.get("TRT_FP16_ENABLE", "1")

    for provider in selected:
        if provider == "TensorrtExecutionProvider":
            os.makedirs(trt_cache_path, exist_ok=True)
            configs.append(
                (
                    "TensorrtExecutionProvider",
                    {
                        "trt_engine_cache_enable": "1",
                        "trt_engine_cache_path": trt_cache_path,
                        "trt_fp16_enable": trt_enable_fp16,
                    },
                )
            )
        else:
            configs.append(provider)

    _execution_provider_configs = configs
    return _execution_provider_configs

# Model sessions (lazy loaded)
_fashion_clip_image_session: Optional[ort.InferenceSession] = None
_fashion_clip_text_session: Optional[ort.InferenceSession] = None
_attribute_model_session: Optional[ort.InferenceSession] = None
_clip_tokenizer: Optional[CLIPTokenizer] = None


def get_fashion_clip_image_session() -> ort.InferenceSession:
    """Get or create FashionCLIP image encoder session"""
    global _fashion_clip_image_session
    if _fashion_clip_image_session is None:
        model_path = os.path.join(MODEL_DIR, "fashion-clip-image.onnx")
        _fashion_clip_image_session = ort.InferenceSession(
            model_path, SESSION_OPTIONS, providers=current_execution_provider_configs()
        )
    return _fashion_clip_image_session


def get_fashion_clip_text_session() -> ort.InferenceSession:
    """Get or create FashionCLIP text encoder session"""
    global _fashion_clip_text_session
    if _fashion_clip_text_session is None:
        model_path = os.path.join(MODEL_DIR, "fashion-clip-text.onnx")
        _fashion_clip_text_session = ort.InferenceSession(
            model_path, SESSION_OPTIONS, providers=current_execution_provider_configs()
        )
    return _fashion_clip_text_session


def get_attribute_model_session() -> ort.InferenceSession:
    """Get or create attribute extraction model session"""
    global _attribute_model_session
    if _attribute_model_session is None:
        model_path = os.path.join(MODEL_DIR, "attribute_model.onnx")
        if os.path.exists(model_path):
            _attribute_model_session = ort.InferenceSession(
                model_path, SESSION_OPTIONS, providers=current_execution_provider_configs()
            )
    return _attribute_model_session


def get_clip_tokenizer() -> CLIPTokenizer:
    """Get or create CLIP tokenizer"""
    global _clip_tokenizer
    if _clip_tokenizer is None:
        # Use OpenAI's CLIP tokenizer (compatible with FashionCLIP)
        _clip_tokenizer = CLIPTokenizer.from_pretrained("openai/clip-vit-base-patch32")
    return _clip_tokenizer


def preprocess_image(image: Image.Image, size: int = 224) -> np.ndarray:
    """
    Preprocess image for CLIP/ResNet models
    - Resize to size x size
    - Normalize with ImageNet mean/std
    - Convert to NCHW format
    """
    # Resize with aspect ratio preservation and center crop
    image = image.convert("RGB")
    
    # Resize so smallest dimension is `size`
    w, h = image.size
    if w < h:
        new_w = size
        new_h = int(h * size / w)
    else:
        new_h = size
        new_w = int(w * size / h)
    
    image = image.resize((new_w, new_h), Image.BILINEAR)
    
    # Center crop to size x size
    left = (new_w - size) // 2
    top = (new_h - size) // 2
    image = image.crop((left, top, left + size, top + size))
    
    # Convert to numpy and normalize
    img_array = np.array(image).astype(np.float32) / 255.0
    
    # ImageNet normalization
    mean = np.array([0.485, 0.456, 0.406])
    std = np.array([0.229, 0.224, 0.225])
    img_array = (img_array - mean) / std
    
    # NHWC to NCHW
    img_array = np.transpose(img_array, (2, 0, 1))
    img_array = np.expand_dims(img_array, axis=0)
    
    return img_array.astype(np.float32)


def compute_image_embedding(image: Image.Image) -> np.ndarray:
    """
    Compute FashionCLIP image embedding
    Returns: 512-dimensional normalized embedding
    """
    session = get_fashion_clip_image_session()
    
    # Preprocess
    input_tensor = preprocess_image(image, size=224)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    embedding = session.run([output_name], {input_name: input_tensor})[0]
    
    # Normalize
    embedding = embedding.squeeze()
    embedding = embedding / np.linalg.norm(embedding)
    
    return embedding


def compute_text_embedding(text: str) -> np.ndarray:
    """
    Compute FashionCLIP text embedding
    Returns: 512-dimensional normalized embedding
    """
    session = get_fashion_clip_text_session()
    tokenizer = get_clip_tokenizer()
    
    # Tokenize text (CLIP uses max length of 77 tokens)
    tokens = tokenizer(
        text,
        padding="max_length",
        max_length=77,
        truncation=True,
        return_tensors="np"
    )
    
    # Extract input IDs as int64
    input_ids = tokens["input_ids"].astype(np.int64)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    embedding = session.run([output_name], {input_name: input_ids})[0]
    
    # Normalize
    embedding = embedding.squeeze()
    embedding = embedding / np.linalg.norm(embedding)
    
    return embedding


def extract_attributes(image: Image.Image) -> Dict[str, Any]:
    """
    Extract fashion attributes from image using trained model
    Returns dict with category, pattern, material predictions
    """
    session = get_attribute_model_session()
    
    if session is None:
        return {"error": "Attribute model not available"}
    
    # Preprocess
    input_tensor = preprocess_image(image, size=224)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: input_tensor})
    
    # Parse outputs (depends on model architecture)
    # Assuming multi-head output: [category_logits, pattern_logits, material_logits]
    result = {}
    
    output_names = [o.name for o in session.get_outputs()]
    
    for i, (name, output) in enumerate(zip(output_names, outputs)):
        probs = softmax(output.squeeze())
        top_idx = np.argmax(probs)
        result[name] = {
            "class_idx": int(top_idx),
            "confidence": float(probs[top_idx]),
            "all_probs": probs.tolist()
        }
    
    return result


def softmax(x: np.ndarray) -> np.ndarray:
    """Compute softmax probabilities"""
    exp_x = np.exp(x - np.max(x))
    return exp_x / exp_x.sum()


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors"""
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def batch_compute_embeddings(images: List[Image.Image]) -> np.ndarray:
    """
    Compute embeddings for a batch of images
    More efficient than computing one at a time
    """
    session = get_fashion_clip_image_session()
    
    # Preprocess all images
    batch = np.concatenate([preprocess_image(img) for img in images], axis=0)
    
    # Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    embeddings = session.run([output_name], {input_name: batch})[0]
    
    # Normalize
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings = embeddings / norms
    
    return embeddings


def rerank_image_pairs(
    query_image: Image.Image,
    candidate_images: List[Image.Image],
    candidate_ids: List[str],
) -> List[Dict[str, Any]]:
    """
    Score a query image against a batch of candidate images.

    This uses the batched ONNX/TensorRT image tower so the service can rerank
    the top-k pool in a single GPU-backed pass. If a dedicated reranker model is
    added later, this function is the swap point.
    """
    if not candidate_images or not candidate_ids:
        return []

    images = [query_image] + candidate_images
    embeddings = batch_compute_embeddings(images)
    query_embedding = embeddings[0]
    candidate_embeddings = embeddings[1:]

    scores = np.clip(np.dot(candidate_embeddings, query_embedding), 0.0, 1.0)
    ranked = [
        {"id": candidate_id, "score": float(score)}
        for candidate_id, score in zip(candidate_ids, scores.tolist())
    ]
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked
