import base64
import io
import json
import os
from contextlib import asynccontextmanager
from typing import Any, Dict

import torch
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel
from transformers import InstructBlipForConditionalGeneration, InstructBlipProcessor


MODEL_PATH = os.getenv("MODEL_PATH", "/app/model")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

processor = None
model = None

FASHION_PROMPT = (
    "Analyze this fashion product image. "
    "Return ONLY valid JSON with these exact fields and value spaces:\n"
    '{"productType":"dress|shirt|pants|jacket|shoes|bag|skirt|shorts|coat|sweater|other",'
    '"gender":"male|female|unisex",'
    '"ageGroup":"adult|youth|kids",'
    '"primaryColor":"black|white|red|blue|green|navy|beige|grey|brown|pink|yellow|orange|purple|multicolor",'
    '"secondaryColor":"same color options or null",'
    '"style":"casual|formal|athletic|boho|streetwear|preppy|minimalist|other",'
    '"material":"denim|leather|cotton|knit|silk|linen|synthetic|wool|null",'
    '"occasion":"everyday|evening|sport|beach|office|outdoor|null",'
    '"confidence":0.0}'
)


def structured_to_caption(payload: Dict[str, Any]) -> str:
    product_type = str(payload.get("productType") or "").strip()
    primary_color = str(payload.get("primaryColor") or "").strip()
    secondary_color = str(payload.get("secondaryColor") or "").strip()
    style = str(payload.get("style") or "").strip()
    material = str(payload.get("material") or "").strip()
    occasion = str(payload.get("occasion") or "").strip()
    gender = str(payload.get("gender") or "").strip()
    age_group = str(payload.get("ageGroup") or "").strip()
    parts = [
        primary_color if primary_color and primary_color != "null" else "",
        secondary_color if secondary_color and secondary_color != "null" else "",
        style if style and style != "other" else "",
        material if material and material != "null" else "",
        product_type if product_type and product_type != "other" else "fashion item",
        f"for {gender}" if gender and gender != "unisex" else "",
        age_group if age_group else "",
        f"occasion {occasion}" if occasion and occasion != "null" else "",
    ]
    return " ".join([p for p in parts if p]).strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global processor, model
    print(f"[BLIP-SVC] loading InstructBLIP from {MODEL_PATH} on {DEVICE}")
    print(
        "[BLIP-SVC] runtime",
        {
            "torch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "cuda_version": torch.version.cuda,
            "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
            "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        },
    )

    processor = InstructBlipProcessor.from_pretrained(
        MODEL_PATH,
        local_files_only=True,
    )

    model_kwargs: Dict[str, Any] = {
        "local_files_only": True,
    }
    if DEVICE == "cuda":
        model_kwargs["load_in_8bit"] = True
        model_kwargs["device_map"] = "auto"
    model = InstructBlipForConditionalGeneration.from_pretrained(MODEL_PATH, **model_kwargs)
    if DEVICE != "cuda":
        model = model.to(DEVICE)

    print("[BLIP-SVC] warmup...")
    dummy = Image.new("RGB", (224, 224), color=128)
    inp = processor(images=dummy, text="What type of clothing is this?", return_tensors="pt")
    if DEVICE == "cuda":
        inp = inp.to("cuda")
    with torch.no_grad():
        model.generate(**inp, max_new_tokens=10, do_sample=False)

    print("[BLIP-SVC] ready")
    yield


app = FastAPI(lifespan=lifespan)


class CaptionRequest(BaseModel):
    image_b64: str


@app.get("/health")
def health():
    return {
        "status": "ready",
        "model_path": MODEL_PATH,
        "device": DEVICE,
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda,
        "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


@app.post("/caption")
async def caption(req: CaptionRequest):
    try:
        img = Image.open(io.BytesIO(base64.b64decode(req.image_b64))).convert("RGB")
        inputs = processor(images=img, text=FASHION_PROMPT, return_tensors="pt")
        if DEVICE == "cuda":
            inputs = inputs.to("cuda")

        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=200, do_sample=False)

        raw = processor.decode(out[0], skip_special_tokens=True).strip()
        clean = raw.strip().replace("```json", "").replace("```", "").strip()
        parsed = json.loads(clean)
        caption_text = structured_to_caption(parsed if isinstance(parsed, dict) else {})
        return {"caption": parsed, "caption_text": caption_text, "error": None}
    except json.JSONDecodeError:
        return {"caption": None, "caption_text": None, "error": "schema_parse_failed"}
    except Exception as e:
        return {"caption": None, "caption_text": None, "error": str(e)}
