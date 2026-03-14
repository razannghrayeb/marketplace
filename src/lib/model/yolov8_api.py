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

import io
from typing import List, Literal, Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

from dual_model_yolo import DualDetector


app = FastAPI(title="Dual-Model Fashion Detection API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Singleton detector instance -------------------------------------------------

_detector: Optional[DualDetector] = None


def get_detector(conf: float | None = None) -> DualDetector:
    global _detector
    if _detector is None:
        _detector = DualDetector(conf=conf or 0.6)
    elif conf is not None and abs(_detector.conf - conf) > 1e-6:  # type: ignore[attr-defined]
        # Re-create with new confidence threshold
        _detector = DualDetector(conf=conf)
    return _detector


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
    num_classes: int
    class_names: List[str]
    config: dict


class LabelsResponse(BaseModel):
    fashion_categories: List[str]
    category_styles: dict
    total: int


def _run_dual_detector(image: Image.Image, conf: float) -> DetectionResponse:
    detector = get_detector(conf=conf)
    result = detector.predict(image)

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
        area_ratio = float(area / float(width * height)) if width and height else 0.0

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
    # We lazily create the detector here if needed
    det = get_detector()
    class_names = sorted({p for p in [c for c in det._LABEL_MAP_A.values()]})  # type: ignore[attr-defined]

    return HealthResponse(
        ok=True,
        model_path="dual-model-yolo (deepfashion2_yolov8s-seg + yolos-fashionpedia)",
        model_loaded=True,
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
    categories = sorted(set(det._LABEL_MAP_A.values()) | det._KEEP_B)  # type: ignore[attr-defined]
    return LabelsResponse(
        fashion_categories=categories,
        category_styles={},
        total=len(categories),
    )


@app.post("/detect", response_model=DetectionResponse)
async def detect(
    file: UploadFile = File(...),
    confidence: float = Query(0.6),
) -> DetectionResponse:
    try:
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}") from exc

    return _run_dual_detector(image, conf=confidence)


@app.post("/detect/batch")
async def detect_batch(
    files: List[UploadFile] = File(...),
    confidence: float = Query(0.6),
):
    results = []
    for f in files:
        try:
            content = await f.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            resp = _run_dual_detector(image, conf=confidence)
            results.append({"filename": f.filename, "result": resp.dict()})
        except Exception as exc:
            results.append({"filename": f.filename, "error": str(exc)})

    return {"results": results}


@app.post("/reload")
def reload(confidence: float = Query(0.6)):
    global _detector
    _detector = DualDetector(conf=confidence)
    return {"ok": True, "message": "Model reloaded", "num_classes": len(_detector._LABEL_MAP_A)}  # type: ignore[attr-defined]


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
