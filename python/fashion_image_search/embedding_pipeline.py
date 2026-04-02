"""
Fashion image → L2-normalized 512-d vector for OpenSearch cosinesimil kNN.

Uses HuggingFace `patrickjohncyh/fashion-clip` (ViT-B/32, 512-d), aligned with
the marketplace default CLIP_MODEL_TYPE=fashion-clip + EXPECTED_EMBEDDING_DIM=512.

Preprocess: resize so the shorter side is 224, center-crop 224×224 (CLIP standard).
Node uses Sharp `cover` + center — visually equivalent for square targets.

Assertions:
  - vector dtype float32, shape (512,)
  - L2 norm ≈ 1.0
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import List, Union

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

logger = logging.getLogger(__name__)

MODEL_ID = "patrickjohncyh/fashion-clip"
EXPECTED_DIM = 512


@dataclass
class FashionClipEncoder:
    model: CLIPModel
    processor: CLIPProcessor
    device: torch.device

    @classmethod
    def load(cls, device: str | None = None) -> "FashionClipEncoder":
        dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        logger.info("Loading %s on %s", MODEL_ID, dev)
        model = CLIPModel.from_pretrained(MODEL_ID)
        processor = CLIPProcessor.from_pretrained(MODEL_ID)
        model = model.to(dev)
        model.eval()
        return cls(model=model, processor=processor, device=dev)

    @torch.inference_mode()
    def embed_pil(self, image: Image.Image) -> np.ndarray:
        if image.mode != "RGB":
            image = image.convert("RGB")
        inputs = self.processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        feats = self.model.get_image_features(**inputs)
        vec = feats[0].float().cpu().numpy()
        return l2_normalize_vector(vec)

    def embed_path(self, path: str) -> np.ndarray:
        with Image.open(path) as im:
            return self.embed_pil(im)

    def embed_bytes(self, data: bytes) -> np.ndarray:
        import io

        with Image.open(io.BytesIO(data)) as im:
            return self.embed_pil(im)


def l2_normalize_vector(vec: np.ndarray) -> np.ndarray:
    x = np.asarray(vec, dtype=np.float32).reshape(-1)
    n = float(np.linalg.norm(x))
    assert x.shape[0] == EXPECTED_DIM, f"expected dim {EXPECTED_DIM}, got {x.shape[0]}"
    if n <= 0:
        raise ValueError("zero-norm embedding")
    out = (x / n).astype(np.float32)
    assert abs(np.linalg.norm(out) - 1.0) < 1e-3, "L2 norm drift after normalize"
    return out


def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float32).reshape(-1)
    b = np.asarray(b, dtype=np.float32).reshape(-1)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def assert_opensearch_cosinesimil_compatible(vec: List[float]) -> None:
    """Vectors stored for space_type cosinesimil should be L2-normalized."""
    v = np.asarray(vec, dtype=np.float64)
    norm = np.linalg.norm(v)
    if not math.isclose(norm, 1.0, rel_tol=0, abs_tol=0.02):
        raise AssertionError(f"vector L2 norm {norm:.6f} not ~1.0 — OpenSearch cosinesimil assumes normalized inputs")
