"""
YOLOv8 Fashion Detection API

Production-ready fashion item detection using YOLOv8 fine-tuned on fashion datasets.
Detects clothing items, accessories, footwear, and bags in images.

Endpoints:
  GET  /health   - Health check + model info
  POST /detect   - Detect fashion items in an image
  GET  /labels   - List all detectable fashion categories
"""

import io
import os
from typing import List, Dict, Any, Optional

import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from ultralytics import YOLO

# ============================================================================
# Configuration
# ============================================================================

MODEL_PATH = os.getenv("YOLOV8_MODEL_PATH", "models/yolov8n.pt")
FASHION_MODEL_PATH = os.getenv("YOLOV8_FASHION_MODEL_PATH", "models/yolov8-fashion.pt")
CONFIDENCE_THRESHOLD = float(os.getenv("YOLOV8_CONFIDENCE_THRESHOLD", "0.25"))
IOU_THRESHOLD = float(os.getenv("YOLOV8_IOU_THRESHOLD", "0.45"))
MAX_DETECTIONS = int(os.getenv("YOLOV8_MAX_DETECTIONS", "30"))
MIN_BOX_AREA_RATIO = float(os.getenv("YOLOV8_MIN_BOX_AREA_RATIO", "0.01"))

# ============================================================================
# Fashion Categories
# ============================================================================

# Map COCO/general labels to fashion-specific categories
FASHION_LABEL_MAP: Dict[str, str] = {
    # Direct mappings from common detection models
    "person": "person",
    
    # Upper body
    "shirt": "shirt",
    "t-shirt": "tshirt",
    "tshirt": "tshirt",
    "blouse": "blouse",
    "sweater": "sweater",
    "hoodie": "hoodie",
    "sweatshirt": "sweatshirt",
    "cardigan": "cardigan",
    "tank top": "tank_top",
    "tank_top": "tank_top",
    "crop top": "crop_top",
    "crop_top": "crop_top",
    "top": "top",
    "polo": "shirt",
    "jersey": "top",
    
    # Dresses
    "dress": "dress",
    "gown": "gown",
    "maxi dress": "maxi_dress",
    "mini dress": "mini_dress",
    "midi dress": "midi_dress",
    "romper": "dress",
    "jumpsuit": "dress",
    
    # Bottoms
    "jeans": "jeans",
    "pants": "pants",
    "trousers": "pants",
    "shorts": "shorts",
    "skirt": "skirt",
    "leggings": "leggings",
    "joggers": "pants",
    
    # Outerwear
    "jacket": "jacket",
    "coat": "coat",
    "blazer": "blazer",
    "parka": "parka",
    "bomber": "bomber",
    "vest": "jacket",
    "windbreaker": "jacket",
    "denim jacket": "jacket",
    "leather jacket": "jacket",
    
    # Footwear
    "shoe": "sneakers",
    "shoes": "sneakers",
    "sneakers": "sneakers",
    "sneaker": "sneakers",
    "boots": "boots",
    "boot": "boots",
    "heels": "heels",
    "high heels": "heels",
    "sandals": "sandals",
    "sandal": "sandals",
    "loafers": "loafers",
    "flats": "flats",
    "slippers": "sandals",
    "trainers": "sneakers",
    
    # Bags
    "bag": "bag",
    "handbag": "bag",
    "purse": "bag",
    "backpack": "backpack",
    "clutch": "clutch",
    "tote": "tote",
    "tote bag": "tote",
    "crossbody": "crossbody",
    "shoulder bag": "bag",
    "suitcase": "bag",
    "luggage": "bag",
    
    # Accessories
    "hat": "hat",
    "cap": "hat",
    "beanie": "hat",
    "sunglasses": "sunglasses",
    "glasses": "sunglasses",
    "watch": "watch",
    "belt": "belt",
    "tie": "tie",
    "bowtie": "tie",
    "scarf": "scarf",
    "gloves": "gloves",
    "umbrella": "umbrella",
    
    # Jewelry
    "necklace": "necklace",
    "bracelet": "bracelet",
    "earrings": "earrings",
    "ring": "ring",
    "jewelry": "jewelry",
}

# All supported fashion categories
FASHION_CATEGORIES = [
    # Tops
    "shirt", "tshirt", "blouse", "sweater", "hoodie", "sweatshirt", 
    "cardigan", "tank_top", "crop_top", "top",
    # Dresses
    "dress", "gown", "maxi_dress", "mini_dress", "midi_dress",
    # Bottoms
    "jeans", "pants", "shorts", "skirt", "leggings",
    # Outerwear
    "jacket", "coat", "blazer", "parka", "bomber",
    # Footwear
    "sneakers", "boots", "heels", "sandals", "loafers", "flats",
    # Bags
    "bag", "backpack", "clutch", "tote", "crossbody",
    # Accessories
    "hat", "sunglasses", "watch", "belt", "tie", "scarf", "gloves",
    # Jewelry
    "necklace", "bracelet", "earrings", "ring", "jewelry",
    # Other
    "person",
]

# Style attributes for detected items
CATEGORY_STYLE_MAP: Dict[str, Dict[str, Any]] = {
    # Dresses
    "dress": {"occasion": "semi-formal", "formality": 6},
    "gown": {"occasion": "formal", "aesthetic": "classic", "formality": 9},
    "maxi_dress": {"occasion": "semi-formal", "aesthetic": "bohemian", "formality": 5},
    "mini_dress": {"occasion": "party", "aesthetic": "modern", "formality": 5},
    "midi_dress": {"occasion": "semi-formal", "aesthetic": "classic", "formality": 6},
    
    # Casual Tops
    "hoodie": {"occasion": "casual", "aesthetic": "streetwear", "formality": 2},
    "sweatshirt": {"occasion": "casual", "aesthetic": "streetwear", "formality": 2},
    "sweater": {"occasion": "casual", "aesthetic": "classic", "formality": 4},
    "cardigan": {"occasion": "casual", "aesthetic": "classic", "formality": 4},
    "tshirt": {"occasion": "casual", "aesthetic": "streetwear", "formality": 2},
    "shirt": {"occasion": "semi-formal", "aesthetic": "classic", "formality": 6},
    "blouse": {"occasion": "semi-formal", "aesthetic": "romantic", "formality": 6},
    "top": {"occasion": "casual", "formality": 4},
    "tank_top": {"occasion": "casual", "aesthetic": "sporty", "formality": 2},
    "crop_top": {"occasion": "party", "aesthetic": "modern", "formality": 3},
    
    # Bottoms
    "jeans": {"occasion": "casual", "aesthetic": "modern", "formality": 3},
    "pants": {"occasion": "semi-formal", "aesthetic": "classic", "formality": 5},
    "shorts": {"occasion": "casual", "aesthetic": "sporty", "formality": 2},
    "skirt": {"occasion": "semi-formal", "aesthetic": "romantic", "formality": 5},
    "leggings": {"occasion": "active", "aesthetic": "sporty", "formality": 1},
    
    # Outerwear
    "jacket": {"occasion": "casual", "formality": 4},
    "blazer": {"occasion": "semi-formal", "aesthetic": "classic", "formality": 7},
    "coat": {"occasion": "semi-formal", "aesthetic": "classic", "formality": 6},
    "parka": {"occasion": "casual", "aesthetic": "streetwear", "formality": 3},
    "bomber": {"occasion": "casual", "aesthetic": "streetwear", "formality": 3},
    
    # Footwear
    "sneakers": {"occasion": "casual", "aesthetic": "streetwear", "formality": 2},
    "heels": {"occasion": "formal", "aesthetic": "classic", "formality": 8},
    "boots": {"occasion": "casual", "aesthetic": "edgy", "formality": 4},
    "sandals": {"occasion": "beach", "aesthetic": "bohemian", "formality": 2},
    "loafers": {"occasion": "semi-formal", "aesthetic": "classic", "formality": 6},
    "flats": {"occasion": "casual", "aesthetic": "minimalist", "formality": 4},
    
    # Bags
    "bag": {"formality": 5},
    "clutch": {"occasion": "formal", "aesthetic": "classic", "formality": 8},
    "tote": {"occasion": "casual", "aesthetic": "minimalist", "formality": 4},
    "backpack": {"occasion": "casual", "aesthetic": "streetwear", "formality": 2},
    "crossbody": {"occasion": "casual", "aesthetic": "modern", "formality": 4},
    
    # Accessories
    "watch": {"formality": 6},
    "jewelry": {"formality": 6},
    "necklace": {"formality": 6},
    "bracelet": {"formality": 5},
    "earrings": {"formality": 6},
    "ring": {"formality": 6},
    "belt": {"formality": 5},
    "scarf": {"formality": 5},
    "hat": {"occasion": "casual", "formality": 3},
    "sunglasses": {"occasion": "casual", "formality": 4},
    "tie": {"occasion": "formal", "aesthetic": "classic", "formality": 8},
}

# ============================================================================
# Pydantic Models
# ============================================================================

class BoundingBox(BaseModel):
    """Bounding box coordinates (normalized 0-1 or pixel values)"""
    x1: float = Field(..., description="Left x coordinate")
    y1: float = Field(..., description="Top y coordinate")
    x2: float = Field(..., description="Right x coordinate")
    y2: float = Field(..., description="Bottom y coordinate")
    
    @property
    def width(self) -> float:
        return self.x2 - self.x1
    
    @property
    def height(self) -> float:
        return self.y2 - self.y1
    
    @property
    def area(self) -> float:
        return self.width * self.height
    
    @property
    def center(self) -> tuple:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)


class StyleInfo(BaseModel):
    """Style attributes for detected item"""
    occasion: Optional[str] = None
    aesthetic: Optional[str] = None
    formality: Optional[int] = Field(None, ge=1, le=10)


class Detection(BaseModel):
    """Single fashion item detection"""
    label: str = Field(..., description="Fashion category label")
    raw_label: str = Field(..., description="Original model label")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence")
    box: BoundingBox = Field(..., description="Bounding box coordinates")
    box_normalized: BoundingBox = Field(..., description="Normalized bounding box (0-1)")
    area_ratio: float = Field(..., description="Box area as ratio of image area")
    style: Optional[StyleInfo] = Field(None, description="Style attributes")


class DetectionResponse(BaseModel):
    """Response from /detect endpoint"""
    success: bool = True
    detections: List[Detection] = Field(default_factory=list)
    count: int = Field(..., description="Number of detections")
    image_size: Dict[str, int] = Field(..., description="Image dimensions")
    model: str = Field(..., description="Model used for detection")
    summary: Dict[str, int] = Field(..., description="Count per category")


class HealthResponse(BaseModel):
    """Response from /health endpoint"""
    ok: bool
    model_path: str
    model_loaded: bool
    num_classes: int
    class_names: List[str]
    config: Dict[str, Any]


class LabelsResponse(BaseModel):
    """Response from /labels endpoint"""
    fashion_categories: List[str]
    category_styles: Dict[str, Dict[str, Any]]
    total: int


# ============================================================================
# FastAPI Application
# ============================================================================

app = FastAPI(
    title="YOLOv8 Fashion Detection API",
    description="Detect fashion items (clothing, accessories, footwear, bags) in images using YOLOv8",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instance
model: Optional[YOLO] = None
model_names: Dict[int, str] = {}


def load_model() -> None:
    """Load YOLOv8 model at startup"""
    global model, model_names
    
    # Try fashion-specific model first, fall back to general model
    model_path = FASHION_MODEL_PATH if os.path.exists(FASHION_MODEL_PATH) else MODEL_PATH
    
    if not os.path.exists(model_path):
        print(f"[YOLOv8] Warning: Model not found at {model_path}")
        print("[YOLOv8] Downloading default YOLOv8n model...")
        model_path = "yolov8n.pt"  # Will auto-download
    
    print(f"[YOLOv8] Loading model from {model_path}...")
    model = YOLO(model_path)
    model_names = model.names
    print(f"[YOLOv8] Model loaded with {len(model_names)} classes")


@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    load_model()


# ============================================================================
# Helper Functions
# ============================================================================

def normalize_label(raw_label: str) -> str:
    """
    Convert raw model label to normalized fashion category.
    
    Args:
        raw_label: Original label from YOLO model
        
    Returns:
        Normalized fashion category label
    """
    label_lower = raw_label.lower().strip()
    
    # Direct mapping
    if label_lower in FASHION_LABEL_MAP:
        return FASHION_LABEL_MAP[label_lower]
    
    # Partial match
    for key, value in FASHION_LABEL_MAP.items():
        if key in label_lower or label_lower in key:
            return value
    
    # Return original if no mapping found
    return label_lower


def clamp_box(
    x1: float, y1: float, x2: float, y2: float,
    width: int, height: int
) -> Optional[tuple]:
    """
    Clamp bounding box to image boundaries.
    
    Args:
        x1, y1, x2, y2: Box coordinates
        width, height: Image dimensions
        
    Returns:
        Clamped (x1, y1, x2, y2) or None if invalid
    """
    x1 = max(0, min(x1, width))
    y1 = max(0, min(y1, height))
    x2 = max(0, min(x2, width))
    y2 = max(0, min(y2, height))
    
    # Ensure valid box
    if x2 <= x1 or y2 <= y1:
        return None
    
    return (x1, y1, x2, y2)


def get_style_info(label: str) -> Optional[StyleInfo]:
    """Get style attributes for a fashion category"""
    if label in CATEGORY_STYLE_MAP:
        style_data = CATEGORY_STYLE_MAP[label]
        return StyleInfo(
            occasion=style_data.get("occasion"),
            aesthetic=style_data.get("aesthetic"),
            formality=style_data.get("formality"),
        )
    return None


def process_image(image_data: bytes) -> Image.Image:
    """
    Load and validate image from bytes.
    
    Args:
        image_data: Raw image bytes
        
    Returns:
        PIL Image in RGB format
    """
    try:
        pil_image = Image.open(io.BytesIO(image_data))
        # Convert to RGB (handles RGBA, grayscale, etc.)
        if pil_image.mode != "RGB":
            pil_image = pil_image.convert("RGB")
        return pil_image
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to process image: {str(e)}"
        )


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint with model information"""
    return HealthResponse(
        ok=model is not None,
        model_path=FASHION_MODEL_PATH if os.path.exists(FASHION_MODEL_PATH) else MODEL_PATH,
        model_loaded=model is not None,
        num_classes=len(model_names) if model_names else 0,
        class_names=list(model_names.values())[:20] if model_names else [],
        config={
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "iou_threshold": IOU_THRESHOLD,
            "max_detections": MAX_DETECTIONS,
            "min_box_area_ratio": MIN_BOX_AREA_RATIO,
        }
    )


@app.get("/labels", response_model=LabelsResponse)
async def get_labels():
    """List all detectable fashion categories and their style attributes"""
    return LabelsResponse(
        fashion_categories=FASHION_CATEGORIES,
        category_styles=CATEGORY_STYLE_MAP,
        total=len(FASHION_CATEGORIES),
    )


@app.post("/detect", response_model=DetectionResponse)
async def detect_fashion_items(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP)"),
    confidence: float = Query(
        default=CONFIDENCE_THRESHOLD,
        ge=0.1,
        le=1.0,
        description="Minimum confidence threshold"
    ),
    include_person: bool = Query(
        default=False,
        description="Include person detections in results"
    ),
    normalized_boxes: bool = Query(
        default=True,
        description="Return normalized box coordinates (0-1)"
    ),
):
    """
    Detect all fashion items in an uploaded image.
    
    Returns bounding boxes, labels, confidence scores, and style attributes
    for each detected fashion item (clothing, accessories, footwear, bags).
    
    **Supported formats:** JPEG, PNG, WebP
    
    **Returns:**
    - `detections`: List of detected items with boxes and metadata
    - `summary`: Count of items per category
    - `count`: Total number of detections
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Validate content type
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/jpg"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type}. Use JPEG, PNG, or WebP."
        )
    
    # Read and process image
    image_data = await file.read()
    pil_image = process_image(image_data)
    width, height = pil_image.size
    img_array = np.array(pil_image)
    img_area = width * height
    
    # Run inference
    results = model.predict(
        source=img_array,
        conf=confidence,
        iou=IOU_THRESHOLD,
        max_det=MAX_DETECTIONS,
        verbose=False,
    )[0]
    
    # Process detections
    detections: List[Detection] = []
    summary: Dict[str, int] = {}
    
    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
        
        # Clamp box to image boundaries
        clamped = clamp_box(x1, y1, x2, y2, width, height)
        if not clamped:
            continue
        
        bx1, by1, bx2, by2 = clamped
        box_area = (bx2 - bx1) * (by2 - by1)
        area_ratio = box_area / img_area
        
        # Skip tiny boxes
        if area_ratio < MIN_BOX_AREA_RATIO:
            continue
        
        # Get and normalize label
        raw_label = model_names.get(cls_id, f"class_{cls_id}")
        label = normalize_label(raw_label)
        
        # Skip person if not requested
        if label == "person" and not include_person:
            continue
        
        # Get style info
        style = get_style_info(label)
        
        # Create detection object
        detection = Detection(
            label=label,
            raw_label=raw_label,
            confidence=round(conf, 4),
            box=BoundingBox(x1=bx1, y1=by1, x2=bx2, y2=by2),
            box_normalized=BoundingBox(
                x1=round(bx1 / width, 4),
                y1=round(by1 / height, 4),
                x2=round(bx2 / width, 4),
                y2=round(by2 / height, 4),
            ),
            area_ratio=round(area_ratio, 4),
            style=style,
        )
        detections.append(detection)
        
        # Update summary
        summary[label] = summary.get(label, 0) + 1
    
    # Sort by confidence (highest first)
    detections.sort(key=lambda d: d.confidence, reverse=True)
    
    return DetectionResponse(
        success=True,
        detections=detections,
        count=len(detections),
        image_size={"width": width, "height": height},
        model=os.path.basename(FASHION_MODEL_PATH if os.path.exists(FASHION_MODEL_PATH) else MODEL_PATH),
        summary=summary,
    )


@app.post("/detect/batch")
async def detect_batch(
    files: List[UploadFile] = File(..., description="Multiple image files"),
    confidence: float = Query(default=CONFIDENCE_THRESHOLD, ge=0.1, le=1.0),
):
    """
    Detect fashion items in multiple images.
    
    Returns a list of detection results, one per image.
    """
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images per batch")
    
    results = []
    for file in files:
        try:
            result = await detect_fashion_items(file=file, confidence=confidence)
            results.append({"filename": file.filename, "result": result})
        except HTTPException as e:
            results.append({"filename": file.filename, "error": e.detail})
    
    return {"results": results, "count": len(results)}


@app.post("/reload")
async def reload_model():
    """Reload the YOLO model from disk"""
    try:
        load_model()
        return {
            "ok": True,
            "message": "Model reloaded",
            "num_classes": len(model_names),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reload: {str(e)}")


# ============================================================================
# Run Server
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("YOLOV8_PORT", "8001"))
    uvicorn.run(
        "yolov8_api:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("YOLOV8_RELOAD", "false").lower() == "true",
    )
    