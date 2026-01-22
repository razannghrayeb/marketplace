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
            model_path, SESSION_OPTIONS, providers=["CPUExecutionProvider"]
        )
    return _fashion_clip_image_session


def get_fashion_clip_text_session() -> ort.InferenceSession:
    """Get or create FashionCLIP text encoder session"""
    global _fashion_clip_text_session
    if _fashion_clip_text_session is None:
        model_path = os.path.join(MODEL_DIR, "fashion-clip-text.onnx")
        _fashion_clip_text_session = ort.InferenceSession(
            model_path, SESSION_OPTIONS, providers=["CPUExecutionProvider"]
        )
    return _fashion_clip_text_session


def get_attribute_model_session() -> ort.InferenceSession:
    """Get or create attribute extraction model session"""
    global _attribute_model_session
    if _attribute_model_session is None:
        model_path = os.path.join(MODEL_DIR, "attribute_model.onnx")
        if os.path.exists(model_path):
            _attribute_model_session = ort.InferenceSession(
                model_path, SESSION_OPTIONS, providers=["CPUExecutionProvider"]
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
