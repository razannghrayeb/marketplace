import os
from typing import List, Tuple, Dict, Any

import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from ultralytics import YOLO
from src.lib.outfit.index import CATEGORY_STYLE_MAP
MODEL_PATH = os.getenv("YOLOV8_MODEL_PATH", "models/yolov8n.pt")
CONF =float(os.getenv("YOLOV8_CONFIDENCE_THRESHOLD", 0.25))
IOU = float(os.getenv("YOLOV8_IOU_THRESHOLD", 0.45))
MAX_DET=int(os.getenv("YOLOV8_MAX_DETECTIONS", 30))
MIN_BOX_DETECTION_AREA=float(os.getenv("YOLOV8_MIN_BOX_DETECTION_AREA", 0.01))

app = FastAPI(title="YOLOv8 Object Detection API", version="1.0.0")
model=YOLO(MODEL_PATH)

def to_rgb (img : Image.Image) -> np.ndarray:
    return np.array(img.convert("RGB"))

def normalize_label(label: str) -> str:
    s =raw.lower().strip()
    if s in CATEGORY_STYLE_MAP:
        return s


async def predict_image(file: UploadFile = File(...)) -> List[Dict[str, Any]]:
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Unsupported image type")
    
    data=await image.read()

    try:
        pil = Image.open(np.frombuffer(data, dtype=np.uint8).tobytes() if False else image.file).convert("RGB")
    except Exception as e:
        from io import BytesIO
        pil = Image.open(BytesIO(data)).convert("RGB")

    width , height = pil.size
    img=to_rgb(pil)
    res=model.predict(
        source=img,
        conf=CONF,
        iou=IOU,
        max_det=MAX_DET,
        verbose=False,
    )[0]
    names=res.names
    dets:List[Dict[str,Any]]=[]
    img_area=width*height

    for b in res.boxes:
        cls_ids=int(b.cls[0])
        conf=float(b.conf[0])
        x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]

        box=_clamp_box(x1, y1, x2, y2, width, height)
        if not box:
            continue
        bx1, by1, bx2, by2 = box
        box_area=(bx2-bx1)*(by2-by1)
        if box_area/img_area < MIN_BOX_DETECTION_AREA:
            continue
        label =normalize_label(names[cls_ids])

        dets.append({
            "label": label,
            "confidence": conf,
            "box": {
                "x1": bx1,
                "y1": by1,
                "x2": bx2,
                "y2": by2,
            },
        })
        dets.sort(key=lambda d: d["conf"], reverse=True)
    return dets