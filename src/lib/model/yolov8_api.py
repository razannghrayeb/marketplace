"""Dual-model fashion detection API service.

This FastAPI app wraps the DualDetector implementation from
dual_model_yolo.py and exposes a YOLOv8-style HTTP interface that is
compatible with the existing TypeScript YOLOv8Client:

- GET  /health
- GET  /labels
- POST /detect
- POST /detect/batch
- POST /reload

The service returns detection results in the same JSON shape expected by
YOLOv8Client, but predictions come from a *hybrid* detector that
combines:

- Model A: deepfashion2_yolov8s-seg (clothing)
- Model B: valentinafeve/yolos-fashionpedia (shoes, bags, hats, etc.)
"""

from __future__ import annotations

import asyncio
import importlib
import io
import logging
import os
import pathlib
import sys
import threading
from contextlib import asynccontextmanager
from concurrent import futures
from typing import List, Optional

import grpc
import numpy as np
import torch
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

from dual_model_yolo import DualDetector
from image_preprocessor import preprocess_for_detection, PreprocessingConfig

log = logging.getLogger("uvicorn.error")
PROTO_PATH = pathlib.Path(__file__).resolve().parent / "proto" / "yolo.proto"
YOLO_GRPC_PORT = int(os.environ.get("YOLO_GRPC_PORT", "50052"))
_grpc_server: Optional[grpc.Server] = None


def _ensure_proto_modules():
    gen_dir = pathlib.Path(__file__).resolve().parent / "_generated_yolo"
    pb2_file = gen_dir / "yolo_pb2.py"
    pb2_grpc_file = gen_dir / "yolo_pb2_grpc.py"
    gen_dir.mkdir(exist_ok=True)

    if not pb2_file.exists() or not pb2_grpc_file.exists():
        from grpc_tools import protoc

        result = protoc.main(
            [
                "grpc_tools.protoc",
                f"-I{PROTO_PATH.parent}",
                f"--python_out={gen_dir}",
                f"--grpc_python_out={gen_dir}",
                str(PROTO_PATH),
            ]
        )
        if result != 0:
            raise RuntimeError(f"grpc proto generation failed: exit={result}")

    if str(gen_dir) not in sys.path:
        sys.path.insert(0, str(gen_dir))
    pb2 = importlib.import_module("yolo_pb2")
    pb2_grpc = importlib.import_module("yolo_pb2_grpc")
    return pb2, pb2_grpc


def _box_to_grpc(pb2, box: BoundingBox):
    return pb2.Box(x1=box.x1, y1=box.y1, x2=box.x2, y2=box.y2)


def _response_to_grpc(pb2, resp: DetectionResponse):
    summary = [
        pb2.SummaryEntry(label=str(label), count=int(count))
        for label, count in resp.summary.items()
    ]
    return pb2.DetectionResponse(
        success=resp.success,
        detections=[
            pb2.Detection(
                label=det.label,
                raw_label=det.raw_label,
                confidence=det.confidence,
                box=_box_to_grpc(pb2, det.box),
                box_normalized=_box_to_grpc(pb2, det.box_normalized),
                area_ratio=det.area_ratio,
            )
            for det in resp.detections
        ],
        count=resp.count,
        image_size=pb2.ImageSize(
            width=int(resp.image_size.get("width", 0)),
            height=int(resp.image_size.get("height", 0)),
        ),
        model=resp.model,
        summary=summary,
    )


def _start_grpc_server():
    pb2, pb2_grpc = _ensure_proto_modules()

    class YoloDetectorService(pb2_grpc.YoloDetectorServicer):
        def Health(self, request, context):
            h = health()
            return pb2.HealthResponse(
                ok=h.ok,
                model_path=h.model_path,
                model_loaded=h.model_loaded,
                runtime_device=h.runtime_device,
                cuda_available=h.cuda_available,
                cuda_device_name=h.cuda_device_name or "",
                cuda_device_count=h.cuda_device_count,
                configured_device=h.configured_device or "",
                requested_device=h.requested_device or "",
                num_classes=h.num_classes,
                class_names=h.class_names,
            )

        def Detect(self, request, context):
            if not request.image_bytes:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("image_bytes is required")
                return pb2.DetectionResponse(success=False)

            try:
                image = Image.open(io.BytesIO(request.image_bytes)).convert("RGB")
                if request.enhance_contrast or request.enhance_sharpness or request.bilateral_filter:
                    config = PreprocessingConfig(
                        enhance_contrast=bool(request.enhance_contrast),
                        enhance_sharpness=bool(request.enhance_sharpness),
                        bilateral_filter=bool(request.bilateral_filter),
                    )
                    image, _ = preprocess_for_detection(image, config)
                conf = float(request.confidence or 0.6)
                return _response_to_grpc(pb2, _run_dual_detector(image, conf=conf))
            except Exception as exc:
                context.set_code(grpc.StatusCode.INTERNAL)
                context.set_details(str(exc))
                return pb2.DetectionResponse(success=False)

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    pb2_grpc.add_YoloDetectorServicer_to_server(YoloDetectorService(), server)
    server.add_insecure_port(f"[::]:{YOLO_GRPC_PORT}")
    server.start()
    log.info("YOLO gRPC server listening on port %s", YOLO_GRPC_PORT)
    return server

# Singleton detector instance -------------------------------------------------

_detector: Optional[DualDetector] = None
_detector_error: Optional[str] = None
_detector_lock = threading.Lock()


def get_detector(conf: float | None = None) -> DualDetector:
    global _detector, _detector_error
    with _detector_lock:
        if _detector is None:
            _detector = DualDetector(conf=conf or 0.6)
            _detector_error = None
        return _detector


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models and run warmup inference so the first real request is fast."""
    global _grpc_server

    rt = _runtime_device_info()
    log.info(
        "YOLO runtime device=%s cuda_available=%s cuda_device=%s cuda_device_count=%s",
        rt["runtime_device"],
        rt["cuda_available"],
        rt["cuda_device_name"] or "n/a",
        rt["cuda_device_count"],
    )

    async def _preload():
        global _detector_error
        try:
            detector = await asyncio.to_thread(get_detector)
            # Warmup: run a dummy inference to compile CUDA kernels.
            # Without this the first real request pays the JIT compilation cost (~1-3s).
            dummy = np.zeros((224, 224, 3), dtype=np.uint8)
            dummy_pil = Image.fromarray(dummy)
            await asyncio.to_thread(detector.predict, dummy_pil)
            log.info("YOLO warmup complete")
        except Exception as e:
            _detector_error = repr(e)
            log.exception("YOLO dual-model preload/warmup failed")

    asyncio.create_task(_preload())
    try:
        _grpc_server = _start_grpc_server()
    except Exception:
        log.exception("YOLO gRPC server failed to start; HTTP endpoints remain available")
        _grpc_server = None
    try:
        yield
    finally:
        if _grpc_server is not None:
            _grpc_server.stop(grace=2)


app = FastAPI(
    title="Dual-Model Fashion Detection API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic models -------------------------------------------------------------


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class StyleInfo(BaseModel):
    occasion: Optional[str] = None
    aesthetic: Optional[str] = None
    formality: Optional[float] = None


class SegmentationMask(BaseModel):
    polygon: List[List[float]]
    polygon_normalized: List[List[float]]
    mask_rle: Optional[str] = None
    mask_area: float
    mask_area_ratio: float


class Detection(BaseModel):
    label: str
    raw_label: str
    confidence: float
    box: BoundingBox
    box_normalized: BoundingBox
    area_ratio: float
    style: Optional[StyleInfo] = None
    mask: Optional[SegmentationMask] = None


class DetectionResponse(BaseModel):
    success: bool
    detections: List[Detection]
    count: int
    image_size: dict
    model: str
    summary: dict


class HealthResponse(BaseModel):
    ok: bool
    model_path: str
    model_loaded: bool
    runtime_device: str
    cuda_available: bool
    cuda_device_name: Optional[str] = None
    cuda_device_count: int
    configured_device: Optional[str] = None
    requested_device: Optional[str] = None
    num_classes: int
    class_names: List[str]
    config: dict


class LabelsResponse(BaseModel):
    fashion_categories: List[str]
    category_styles: dict
    total: int


def _runtime_device_info() -> dict:
    cuda_available = bool(torch.cuda.is_available())
    runtime_device = "cuda" if cuda_available else "cpu"
    cuda_device_name = None
    cuda_device_count = 0
    if cuda_available:
        cuda_device_count = int(torch.cuda.device_count())
        try:
            cuda_device_name = str(torch.cuda.get_device_name(0))
        except Exception:
            cuda_device_name = None
    requested_device = str((__import__("os").environ.get("YOLO_DEVICE") or "")).strip().lower() or None
    effective_device = None
    try:
        from dual_model_yolo import _TORCH_DEVICE as dual_torch_device  # type: ignore
        effective_device = str(dual_torch_device)
    except Exception:
        effective_device = "cuda" if cuda_available else "cpu"
    return {
        "runtime_device": runtime_device,
        "cuda_available": cuda_available,
        "cuda_device_name": cuda_device_name,
        "cuda_device_count": cuda_device_count,
        "configured_device": effective_device,
        "requested_device": requested_device,
    }


def _run_dual_detector(image: Image.Image, conf: float) -> DetectionResponse:
    detector = get_detector()
    result = detector.predict(image, conf=conf)

    width, height = image.size

    detections: List[Detection] = []
    summary: dict[str, int] = {}

    for p in result["all"]:
        lbl = str(p["label"])  # type: ignore[index]
        score = float(p["score"])  # type: ignore[index]
        x1, y1, x2, y2 = [float(v) for v in p["box"]]  # type: ignore[index]

        box = BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2)
        box_norm = BoundingBox(
            x1=x1 / width,
            y1=y1 / height,
            x2=x2 / width,
            y2=y2 / height,
        )

        area = (x2 - x1) * (y2 - y1)
        area_ratio = float(area / float(width * height)
                           ) if width and height else 0.0

        det = Detection(
            label=lbl,
            raw_label=lbl,
            confidence=score,
            box=box,
            box_normalized=box_norm,
            area_ratio=area_ratio,
        )
        detections.append(det)
        summary[lbl] = summary.get(lbl, 0) + 1

    return DetectionResponse(
        success=True,
        detections=detections,
        count=len(detections),
        image_size={"width": width, "height": height},
        model="dual-detector-v1",
        summary=summary,
    )


# Routes ----------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness: always fast. `model_loaded` becomes true after background preload (or first detect)."""
    model_path = "dual-model-yolo (deepfashion2_yolov8s-seg + yolos-fashionpedia)"
    rt = _runtime_device_info()
    if _detector is None:
        return HealthResponse(
            ok=_detector_error is None,
            model_path=model_path,
            model_loaded=False,
            runtime_device=rt["runtime_device"],
            cuda_available=rt["cuda_available"],
            cuda_device_name=rt["cuda_device_name"],
            cuda_device_count=rt["cuda_device_count"],
            configured_device=rt.get("configured_device"),
            requested_device=rt.get("requested_device"),
            num_classes=0,
            class_names=[],
            config={
                "confidence_threshold": 0.6,
                "iou_threshold": 0.45,
                "max_detections": 300,
                "min_box_area_ratio": 0.0,
            },
        )

    det = _detector
    # type: ignore[attr-defined]
    class_names = sorted({p for p in [c for c in det._LABEL_MAP_A.values()]})

    return HealthResponse(
        ok=True,
        model_path=model_path,
        model_loaded=True,
        runtime_device=rt["runtime_device"],
        cuda_available=rt["cuda_available"],
        cuda_device_name=rt["cuda_device_name"],
        cuda_device_count=rt["cuda_device_count"],
        configured_device=rt.get("configured_device"),
        requested_device=rt.get("requested_device"),
        num_classes=len(class_names),
        class_names=class_names,
        config={
            "confidence_threshold": det.conf,  # type: ignore[attr-defined]
            "iou_threshold": det.overlap_iou,  # type: ignore[attr-defined]
            "max_detections": 300,
            "min_box_area_ratio": 0.0,
        },
    )


@app.get("/labels", response_model=LabelsResponse)
def labels() -> LabelsResponse:
    det = get_detector()
    categories = sorted(set(det._LABEL_MAP_A.values()) |
                        det._KEEP_B)  # type: ignore[attr-defined]
    return LabelsResponse(
        fashion_categories=categories,
        category_styles={},
        total=len(categories),
    )


@app.post("/detect", response_model=DetectionResponse)
async def detect(
    file: UploadFile = File(...),
    confidence: float = Query(0.6),
    enhance_contrast: bool = Query(
        False, description="Apply contrast enhancement"),
    enhance_sharpness: bool = Query(
        False, description="Apply sharpness enhancement"),
    bilateral_filter: bool = Query(
        False, description="Apply bilateral filtering for noise reduction"),
) -> DetectionResponse:
    try:
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=400, detail=f"Invalid image: {exc}") from exc

    # Apply preprocessing if any option is enabled
    if enhance_contrast or enhance_sharpness or bilateral_filter:
        config = PreprocessingConfig(
            enhance_contrast=enhance_contrast,
            enhance_sharpness=enhance_sharpness,
            bilateral_filter=bilateral_filter,
        )
        image, _ = preprocess_for_detection(image, config)

    return _run_dual_detector(image, conf=confidence)


@app.post("/detect/batch")
async def detect_batch(
    files: List[UploadFile] = File(...),
    confidence: float = Query(0.6),
    enhance_contrast: bool = Query(
        False, description="Apply contrast enhancement"),
    enhance_sharpness: bool = Query(
        False, description="Apply sharpness enhancement"),
    bilateral_filter: bool = Query(
        False, description="Apply bilateral filtering for noise reduction"),
):
    # Create preprocessing config if needed
    preprocess_config = None
    if enhance_contrast or enhance_sharpness or bilateral_filter:
        preprocess_config = PreprocessingConfig(
            enhance_contrast=enhance_contrast,
            enhance_sharpness=enhance_sharpness,
            bilateral_filter=bilateral_filter,
        )

    results = []
    for f in files:
        try:
            content = await f.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")

            # Apply preprocessing if configured
            if preprocess_config:
                image, _ = preprocess_for_detection(image, preprocess_config)

            resp = _run_dual_detector(image, conf=confidence)
            results.append({"filename": f.filename, "result": resp.dict()})
        except Exception as exc:
            results.append({"filename": f.filename, "error": str(exc)})

    return {"results": results}


@app.post("/reload")
def reload(confidence: float = Query(0.6)):
    global _detector, _detector_error
    with _detector_lock:
        _detector = DualDetector(conf=confidence)
        _detector_error = None
    # type: ignore[attr-defined]
    return {"ok": True, "message": "Model reloaded", "num_classes": len(_detector._LABEL_MAP_A)}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
