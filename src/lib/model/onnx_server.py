"""
ONNX Inference Server
FastAPI server for FashionCLIP embedding and attribute extraction
"""
import os
import io
import time
import base64
import asyncio
import importlib
import pathlib
import urllib.request
from concurrent import futures
from typing import List, Optional
from PIL import Image
import numpy as np
import grpc

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from onnx_inference import (
    compute_image_embedding,
    extract_attributes,
    batch_compute_embeddings,
    cosine_similarity,
    current_execution_providers,
    rerank_image_pairs,
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
service_ready = False
warmup_passes_done = 0


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
    execution_providers: List[str]


class RerankCandidate(BaseModel):
    id: str
    image_b64: str


class RerankRequest(BaseModel):
    query_image_b64: str
    candidates: List[RerankCandidate]


class RerankScore(BaseModel):
    id: str
    score: float


class RerankResponse(BaseModel):
    scores: List[RerankScore]
    count: int
    execution_providers: List[str]
    max_batch_size: int


RERANK_MAX_BATCH_SIZE = int(os.environ.get("RERANK_MAX_BATCH_SIZE", "200"))
WARMUP_PASSES = max(1, int(os.environ.get("ONNX_WARMUP_PASSES", "8")))
ONNX_GRPC_PORT = int(os.environ.get("ONNX_GRPC_PORT", "50051"))
PROTO_PATH = pathlib.Path(__file__).resolve().parent / "proto" / "rerank.proto"


def _ensure_proto_modules():
    """
    Ensure grpc/protobuf Python modules exist for rerank.proto.
    Generates them at runtime when the generated modules are not baked in.
    """
    generated_dir = pathlib.Path(__file__).resolve().parent / "_generated"
    generated_dir.mkdir(parents=True, exist_ok=True)
    init_py = generated_dir / "__init__.py"
    if not init_py.exists():
        init_py.write_text("", encoding="utf-8")

    if str(generated_dir.parent) not in os.sys.path:
        os.sys.path.insert(0, str(generated_dir.parent))

    try:
        pb2 = importlib.import_module("_generated.rerank_pb2")
        pb2_grpc = importlib.import_module("_generated.rerank_pb2_grpc")
        return pb2, pb2_grpc
    except ModuleNotFoundError:
        pass

    from grpc_tools import protoc

    result = protoc.main(
        [
            "grpc_tools.protoc",
            f"-I{PROTO_PATH.parent}",
            f"--python_out={generated_dir}",
            f"--grpc_python_out={generated_dir}",
            str(PROTO_PATH),
        ]
    )
    if result != 0:
        raise RuntimeError(f"Failed to compile protobuf definitions (code={result})")

    pb2 = importlib.import_module("_generated.rerank_pb2")
    pb2_grpc = importlib.import_module("_generated.rerank_pb2_grpc")
    return pb2, pb2_grpc


def _warmup_model():
    """Run dummy inference passes so first real request avoids CUDA cold-start latency."""
    global warmup_passes_done

    dummy = Image.fromarray(np.random.randint(0, 255, size=(224, 224, 3), dtype=np.uint8), mode="RGB")
    for _ in range(WARMUP_PASSES):
        compute_image_embedding(dummy)
        warmup_passes_done += 1


def _decode_candidate_image(candidate) -> Optional[Image.Image]:
    if getattr(candidate, "image_bytes", b""):
        return Image.open(io.BytesIO(candidate.image_bytes)).convert("RGB")
    if getattr(candidate, "image_url", ""):
        try:
            # URL fetch stays optional for compatibility; Node should prefer bytes for throughput.
            with urllib.request.urlopen(candidate.image_url, timeout=10) as resp:
                return Image.open(io.BytesIO(resp.read())).convert("RGB")
        except Exception:
            return None
    return None


def _start_grpc_server():
    pb2, pb2_grpc = _ensure_proto_modules()

    class ImageRerankerService(pb2_grpc.ImageRerankerServicer):
        def Health(self, request, context):
            providers = current_execution_providers()
            return pb2.HealthResponse(
                ready=service_ready,
                status="ready" if service_ready else "warming",
                execution_provider=providers[0] if providers else "CPUExecutionProvider",
            )

        def RerankImagePairs(self, request, context):
            if not service_ready:
                context.set_code(grpc.StatusCode.UNAVAILABLE)
                context.set_details("Service warming up")
                return pb2.RerankResponse(scores=[], count=0, max_batch_size=RERANK_MAX_BATCH_SIZE)

            if not request.query_image_bytes:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("query_image_bytes is required")
                return pb2.RerankResponse(scores=[], count=0, max_batch_size=RERANK_MAX_BATCH_SIZE)

            query = Image.open(io.BytesIO(request.query_image_bytes)).convert("RGB")
            scored_candidates = []
            candidate_ids = []
            for candidate in request.candidates[:RERANK_MAX_BATCH_SIZE]:
                image = _decode_candidate_image(candidate)
                if image is None:
                    continue
                scored_candidates.append(image)
                candidate_ids.append(candidate.id)

            if not scored_candidates:
                return pb2.RerankResponse(scores=[], count=0, max_batch_size=RERANK_MAX_BATCH_SIZE)

            ranked = rerank_image_pairs(query, scored_candidates, candidate_ids)
            return pb2.RerankResponse(
                scores=[pb2.Score(id=item["id"], score=float(item["score"])) for item in ranked],
                count=len(ranked),
                max_batch_size=RERANK_MAX_BATCH_SIZE,
            )

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    pb2_grpc.add_ImageRerankerServicer_to_server(ImageRerankerService(), server)
    server.add_insecure_port(f"[::]:{ONNX_GRPC_PORT}")
    server.start()
    print(f"[ONNX-gRPC] listening on :{ONNX_GRPC_PORT}")
    return server


grpc_server = _start_grpc_server()


@app.on_event("startup")
async def startup_event():
    global service_ready
    print(f"[ONNX] warmup started with {WARMUP_PASSES} passes")
    await asyncio.to_thread(_warmup_model)
    service_ready = True
    print("[ONNX] warmup finished; service ready")


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    avg_time = total_inference_time / request_count if request_count > 0 else 0
    return HealthResponse(
        status="healthy" if service_ready else "warming",
        requests_served=request_count,
        avg_inference_time_ms=avg_time,
        execution_providers=current_execution_providers(),
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


@app.post("/rerank/image-pairs", response_model=RerankResponse)
async def rerank_image_pairs_endpoint(request: RerankRequest):
    """
    Score a query image against a batch of candidate images.

    The Node search pipeline sends its top candidates here in one request so
    reranking can run as a single batched GPU pass.
    """
    global request_count, total_inference_time

    try:
        if not service_ready:
            raise HTTPException(status_code=503, detail="Service warming up")

        if not request.candidates:
            return RerankResponse(
                scores=[],
                count=0,
                execution_providers=current_execution_providers(),
                max_batch_size=RERANK_MAX_BATCH_SIZE,
            )

        candidate_slice = request.candidates[:RERANK_MAX_BATCH_SIZE]
        query_image = Image.open(io.BytesIO(base64.b64decode(request.query_image_b64))).convert("RGB")
        candidate_images = [
            Image.open(io.BytesIO(base64.b64decode(candidate.image_b64))).convert("RGB")
            for candidate in candidate_slice
        ]
        candidate_ids = [candidate.id for candidate in candidate_slice]

        start = time.perf_counter()
        scores = rerank_image_pairs(query_image, candidate_images, candidate_ids)
        elapsed = (time.perf_counter() - start) * 1000

        request_count += 1
        total_inference_time += elapsed

        return RerankResponse(
            scores=[RerankScore(**item) for item in scores],
            count=len(scores),
            execution_providers=current_execution_providers(),
            max_batch_size=RERANK_MAX_BATCH_SIZE,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
