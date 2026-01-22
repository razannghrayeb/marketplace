"""
ONNX Inference Server
FastAPI server for FashionCLIP embedding and attribute extraction
"""
import os
import io
import time
from typing import List, Optional
from PIL import Image
import numpy as np

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from onnx_inference import (
    compute_image_embedding,
    extract_attributes,
    batch_compute_embeddings,
    cosine_similarity,
)

app = FastAPI(
    title="Fashion ONNX Inference API",
    description="FashionCLIP embedding and attribute extraction service",
    version="1.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Metrics
request_count = 0
total_inference_time = 0.0


class EmbeddingResponse(BaseModel):
    embedding: List[float]
    inference_time_ms: float


class AttributeResponse(BaseModel):
    attributes: dict
    inference_time_ms: float


class SimilarityRequest(BaseModel):
    embedding_a: List[float]
    embedding_b: List[float]


class SimilarityResponse(BaseModel):
    similarity: float


class BatchEmbeddingResponse(BaseModel):
    embeddings: List[List[float]]
    count: int
    inference_time_ms: float


class HealthResponse(BaseModel):
    status: str
    requests_served: int
    avg_inference_time_ms: float


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    avg_time = total_inference_time / request_count if request_count > 0 else 0
    return HealthResponse(
        status="healthy",
        requests_served=request_count,
        avg_inference_time_ms=avg_time,
    )


@app.post("/embed/image", response_model=EmbeddingResponse)
async def embed_image(file: UploadFile = File(...)):
    """
    Generate FashionCLIP embedding for an image
    """
    global request_count, total_inference_time
    
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        start = time.perf_counter()
        embedding = compute_image_embedding(image)
        elapsed = (time.perf_counter() - start) * 1000
        
        request_count += 1
        total_inference_time += elapsed
        
        return EmbeddingResponse(
            embedding=embedding.tolist(),
            inference_time_ms=elapsed,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed/batch", response_model=BatchEmbeddingResponse)
async def embed_batch(files: List[UploadFile] = File(...)):
    """
    Generate embeddings for multiple images in a batch
    More efficient than calling /embed/image multiple times
    """
    global request_count, total_inference_time
    
    if len(files) > 32:
        raise HTTPException(status_code=400, detail="Maximum batch size is 32")
    
    try:
        images = []
        for file in files:
            contents = await file.read()
            image = Image.open(io.BytesIO(contents))
            images.append(image)
        
        start = time.perf_counter()
        embeddings = batch_compute_embeddings(images)
        elapsed = (time.perf_counter() - start) * 1000
        
        request_count += 1
        total_inference_time += elapsed
        
        return BatchEmbeddingResponse(
            embeddings=embeddings.tolist(),
            count=len(images),
            inference_time_ms=elapsed,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/attributes", response_model=AttributeResponse)
async def extract_image_attributes(file: UploadFile = File(...)):
    """
    Extract fashion attributes (category, pattern, material) from image
    """
    global request_count, total_inference_time
    
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        start = time.perf_counter()
        attributes = extract_attributes(image)
        elapsed = (time.perf_counter() - start) * 1000
        
        request_count += 1
        total_inference_time += elapsed
        
        return AttributeResponse(
            attributes=attributes,
            inference_time_ms=elapsed,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/similarity", response_model=SimilarityResponse)
async def compute_similarity(request: SimilarityRequest):
    """
    Compute cosine similarity between two embeddings
    """
    try:
        a = np.array(request.embedding_a, dtype=np.float32)
        b = np.array(request.embedding_b, dtype=np.float32)
        
        if len(a) != len(b):
            raise HTTPException(
                status_code=400, 
                detail="Embeddings must have same dimension"
            )
        
        similarity = cosine_similarity(a, b)
        return SimilarityResponse(similarity=similarity)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
