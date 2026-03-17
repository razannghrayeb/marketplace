"""
dual_detector.py
=================
Drop-in dual-model detector you can import into ANY project.

Usage
-----
    from dual_detector import DualDetector

    # Initialise once (loads both models)
    detector = DualDetector()

    # Run on anything
    result = detector.predict("path/to/image.jpg")
    result = detector.predict("https://example.com/photo.jpg")
    result = detector.predict(pil_image)          # PIL.Image
    result = detector.predict(numpy_array)        # HxWx3 BGR or RGB

    # Result is a plain dict — use however you like
    print(result["clothing"])     # list of clothing predictions
    print(result["accessories"])  # list of shoe / bag / hat predictions
    print(result["all"])          # merged list

    # Show it
    detector.show(result)

    # Save annotated image
    detector.save(result, "out.jpg")

Each prediction dict has:
    { "label": str, "score": float, "box": (x1,y1,x2,y2), "source": "A"|"B" }
"""

# ── deps ──────────────────────────────────────────────────────────────────────
import subprocess, sys

def _pip(*pkgs):
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *pkgs])

for pkg, imp in [("ultralytics","ultralytics"),
                 ("huggingface_hub","huggingface_hub"),
                 ("transformers","transformers"),
                 ("timm","timm")]:
    try: __import__(imp)
    except ImportError: _pip(pkg)

# ── imports ───────────────────────────────────────────────────────────────────
import os, io, warnings, tempfile, urllib.request
from pathlib import Path

import cv2
import numpy as np
import torch
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO
from huggingface_hub import hf_hub_download
from transformers import pipeline as hf_pipeline

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────

class DualDetector:
    """
    Two-model fashion detector.

    Model A — deepfashion2_yolov8s-seg   → clothing (13 classes)
    Model B — yolos-fashionpedia         → shoe, bag/wallet, hat, headband
    """

    # Model A: raw label → human-readable / CSV-compatible name
    _LABEL_MAP_A = {
        "long_sleeved_shirt":    "long sleeve top",
        "short_sleeved_shirt":   "short sleeve top",
        "long_sleeved_outwear":  "long sleeve outwear",
        "short_sleeved_outwear": "short sleeve outwear",
        "vest":                  "vest",
        "sling":                 "sling",
        "shorts":                "shorts",
        "trousers":              "trousers",
        "skirt":                 "skirt",
        "short_sleeved_dress":   "short sleeve dress",
        "long_sleeved_dress":    "long sleeve dress",
        "vest_dress":            "vest dress",
        "sling_dress":           "sling dress",
    }

    # Model B: only these labels are kept
    _KEEP_B = {
        "shoe",
        "bag, wallet",
        "hat",
        "headband, head covering, hair accessory",
    }

    # Display colours
    _COLORS = {
        "clothing": "#4FC3F7",
        "shoe":     "#A5D6A7",
        "bag":      "#FFB74D",
        "hat":      "#FFF176",
    }

    def __init__(self, conf: float = 0.60, overlap_iou: float = 0.45):
        """
        Parameters
        ----------
        conf        : confidence threshold applied to both models (default 0.60)
        overlap_iou : IoU threshold for cross-model NMS (default 0.45)
        """
        self.conf        = conf
        self.overlap_iou = overlap_iou
        self._model_a    = None
        self._model_b    = None
        self._font       = self._load_font()
        self._load_models()

    # ── private: setup ────────────────────────────────────────────────────────

    def _load_models(self):
        print("Loading Model A: deepfashion2_yolov8s-seg …")
        path = hf_hub_download(repo_id="Bingsu/adetailer",
                               filename="deepfashion2_yolov8s-seg.pt")
        self._model_a = YOLO(path)
        print(f"  ✓ {len(self._model_a.names)} clothing classes")

        print("Loading Model B: yolos-fashionpedia …")
        device = 0 if torch.cuda.is_available() else -1
        self._model_b = hf_pipeline(
            "object-detection",
            model="valentinafeve/yolos-fashionpedia",
            device=device,
        )
        print(f"  ✓ Fashionpedia  |  keeping: {self._KEEP_B}")
        print(f"  ✓ Both models conf ≥ {self.conf}\n")

    @staticmethod
    def _load_font(size: int = 13) -> ImageFont.ImageFont:
        for p in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]:
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    # ── private: helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _iou(a, b) -> float:
        xi1=max(a[0],b[0]); yi1=max(a[1],b[1])
        xi2=min(a[2],b[2]); yi2=min(a[3],b[3])
        inter=max(0,xi2-xi1)*max(0,yi2-yi1)
        if inter==0: return 0.0
        return inter/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter)

    def _pred_color(self, lbl: str) -> str:
        if lbl == "shoe":                                     return self._COLORS["shoe"]
        if lbl == "bag, wallet":                              return self._COLORS["bag"]
        if lbl in ("hat","headband, head covering, hair accessory"):
            return self._COLORS["hat"]
        return self._COLORS["clothing"]

    def _to_pil(self, image) -> tuple[Image.Image, str | None]:
        """
        Accept: file path str, URL str, PIL.Image, numpy array.
        Returns (PIL image RGB, tmp_path_or_None).
        """
        tmp = None

        if isinstance(image, str):
            if image.startswith("http"):
                suffix = Path(image.split("?")[0]).suffix or ".jpg"
                t = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
                urllib.request.urlretrieve(image, t.name)
                tmp = t.name
                return Image.open(tmp).convert("RGB"), tmp
            return Image.open(image).convert("RGB"), tmp

        if isinstance(image, np.ndarray):
            if image.shape[2] == 3:
                rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            else:
                rgb = image
            return Image.fromarray(rgb), tmp

        if isinstance(image, Image.Image):
            return image.convert("RGB"), tmp

        raise TypeError(f"Unsupported image type: {type(image)}")

    # ── public: predict ───────────────────────────────────────────────────────

    def predict(self, image) -> dict:
        """
        Run both models on `image` and return merged predictions.

        Parameters
        ----------
        image : str (file path or URL) | PIL.Image | numpy array (BGR or RGB)

        Returns
        -------
        dict with keys:
            "clothing"    : list of clothing prediction dicts
            "accessories" : list of shoe/bag/hat prediction dicts
            "all"         : combined list
            "orig_rgb"    : np.ndarray HxWx3 RGB original image
            "a_plot"      : np.ndarray HxWx3 RGB Model A annotated frame
        """
        # Resolve to a file path for Model A (YOLO needs a path or array)
        pil_img, tmp = self._to_pil(image)
        img_source   = tmp if tmp else (image if isinstance(image, str) else pil_img)

        # --- Model A: clothing ---
        res_a    = self._model_a.predict(source=img_source,
                                         conf=self.conf, verbose=False)[0]
        orig_rgb = cv2.cvtColor(res_a.orig_img, cv2.COLOR_BGR2RGB)
        a_plot   = cv2.cvtColor(res_a.plot(),   cv2.COLOR_BGR2RGB)

        clothing = []
        if res_a.boxes is not None:
            for box in res_a.boxes:
                raw   = self._model_a.names[int(box.cls[0])]
                score = float(box.conf[0])
                if score < self.conf: continue
                clothing.append({
                    "label":  self._LABEL_MAP_A.get(raw, raw),
                    "score":  score,
                    "box":    tuple(box.xyxy[0].tolist()),
                    "source": "A",
                })

        # --- Model B: accessories ---
        raw_b = self._model_b(pil_img)
        acc   = []
        for det in raw_b:
            lbl, score = det["label"], det["score"]
            if lbl not in self._KEEP_B: continue
            if score < self.conf:       continue
            b = det["box"]
            acc.append({
                "label":  lbl,
                "score":  score,
                "box":    (b["xmin"], b["ymin"], b["xmax"], b["ymax"]),
                "source": "B",
            })

        # --- Cross-model NMS ---
        suppressed = {
            ai for ai, a in enumerate(acc)
            if any(self._iou(a["box"], c["box"]) > self.overlap_iou
                   for c in clothing)
        }
        acc = [p for i, p in enumerate(acc) if i not in suppressed]

        if tmp:
            os.unlink(tmp)

        return {
            "clothing":    clothing,
            "accessories": acc,
            "all":         clothing + acc,
            "orig_rgb":    orig_rgb,
            "a_plot":      a_plot,
        }

    # ── public: draw ─────────────────────────────────────────────────────────

    def draw(self, result: dict) -> Image.Image:
        """Return annotated PIL image with all predictions drawn."""
        pil  = Image.fromarray(result["orig_rgb"].copy())
        draw = ImageDraw.Draw(pil)
        for pred in sorted(result["all"], key=lambda x: x["score"]):
            x1,y1,x2,y2 = [int(v) for v in pred["box"]]
            color = self._pred_color(pred["label"])
            tag   = f'{pred["label"]}  {pred["score"]:.2f}'
            draw.rectangle([x1,y1,x2,y2], outline=color, width=3)
            tw = len(tag)*7+6
            draw.rectangle([x1, max(0,y1-20), x1+tw, y1], fill=color)
            txt = "black" if color in ("#FFB74D","#A5D6A7","#FFF176") else "white"
            draw.text((x1+3, max(0,y1-19)), tag, fill=txt, font=self._font)
        return pil

    # ── public: show ──────────────────────────────────────────────────────────

    def show(self, result: dict, title: str = ""):
        """Display 3-panel figure: Original | Model A | Merged."""
        n_cloth = len(result["clothing"])
        n_shoe  = sum(1 for p in result["accessories"] if p["label"]=="shoe")
        n_bag   = sum(1 for p in result["accessories"] if p["label"]=="bag, wallet")
        n_hat   = sum(1 for p in result["accessories"] if p["label"] in
                      ("hat","headband, head covering, hair accessory"))

        fig, axes = plt.subplots(1, 3, figsize=(23, 7))
        fig.patch.set_facecolor("#0d0d0d")

        axes[0].imshow(result["orig_rgb"])
        axes[0].set_title("Original", color="white", fontsize=11, pad=8)

        axes[1].imshow(result["a_plot"])
        axes[1].set_title(
            f"Model A — clothing  ({n_cloth} dets, conf≥{self.conf})",
            color="#4FC3F7", fontsize=11, pad=8)

        axes[2].imshow(self.draw(result))
        axes[2].set_title(
            f"Merged — {n_cloth} clothing  +  {n_shoe} shoes"
            f"  +  {n_bag} bags  +  {n_hat} hats",
            color="#FFB74D", fontsize=11, pad=8)

        for ax in axes:
            ax.axis("off"); ax.set_facecolor("#0d0d0d")

        axes[2].legend(handles=[
            mpatches.Patch(color=self._COLORS["clothing"], label="Clothing (Model A)"),
            mpatches.Patch(color=self._COLORS["shoe"],     label="Shoe (Model B)"),
            mpatches.Patch(color=self._COLORS["bag"],      label="Bag  (Model B)"),
            mpatches.Patch(color=self._COLORS["hat"],      label="Hat  (Model B)"),
        ], loc="lower right", facecolor="#1a1a1a", labelcolor="white", fontsize=9)

        if title:
            plt.suptitle(title, color="white", fontsize=10, y=0.01)
        plt.tight_layout(rect=[0, 0.03, 1, 1])
        plt.show()

    # ── public: save ──────────────────────────────────────────────────────────

    def save(self, result: dict, out_path: str):
        """Save the annotated merged image to disk."""
        annotated = self.draw(result)
        annotated.save(out_path)
        print(f"✓ Saved → {out_path}")

    # ── public: summary ───────────────────────────────────────────────────────

    def summary(self, result: dict):
        """Print a clean detection table to stdout."""
        preds = result["all"]
        if not preds:
            print("  No detections above conf threshold.")
            return
        print(f"\n  {'Label':<36} {'Conf':>5}  Source")
        print(f"  {'─'*36} {'─'*5}  {'─'*8}")
        for p in sorted(preds, key=lambda x: -x["score"]):
            print(f"  {p['label']:<36} {p['score']:>5.3f}  Model {p['source']}")
        print()


# ─────────────────────────────────────────────────────────────────────────────
# INTEGRATION EXAMPLES — copy whichever fits your project
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    # ── Example 1: Kaggle notebook / script ──────────────────────────────────
    #
    #   detector = DualDetector(conf=0.60)
    #   result   = detector.predict("/kaggle/input/.../image.jpg")
    #   detector.show(result)
    #   detector.summary(result)

    # ── Example 2: Loop over a folder ────────────────────────────────────────
    #
    #   import os
    #   detector = DualDetector(conf=0.60)
    #   for fname in os.listdir("/kaggle/input/my-images"):
    #       path   = os.path.join("/kaggle/input/my-images", fname)
    #       result = detector.predict(path)
    #       detector.show(result, title=fname)
    #       detector.save(result, f"/kaggle/working/{fname}")

    # ── Example 3: Flask / FastAPI endpoint ──────────────────────────────────
    #
    #   from flask import Flask, request, jsonify
    #   from PIL import Image
    #   import io
    #
    #   app      = Flask(__name__)
    #   detector = DualDetector(conf=0.60)   # load once at startup
    #
    #   @app.route("/predict", methods=["POST"])
    #   def predict():
    #       img    = Image.open(io.BytesIO(request.data))
    #       result = detector.predict(img)
    #       return jsonify({
    #           "clothing":    [{"label":p["label"],"score":p["score"],"box":p["box"]}
    #                           for p in result["clothing"]],
    #           "accessories": [{"label":p["label"],"score":p["score"],"box":p["box"]}
    #                           for p in result["accessories"]],
    #       })

    # ── Example 4: Gradio demo ────────────────────────────────────────────────
    #
    #   import gradio as gr
    #   import numpy as np
    #
    #   detector = DualDetector(conf=0.60)
    #
    #   def run(img_array):                    # Gradio passes numpy RGB array
    #       result = detector.predict(img_array)
    #       annotated = np.array(detector.draw(result))
    #       labels = [(p["label"], p["score"]) for p in result["all"]]
    #       return annotated, labels
    #
    #   gr.Interface(
    #       fn=run,
    #       inputs=gr.Image(),
    #       outputs=[gr.Image(), gr.JSON()],
    #       title="Fashion Detector",
    #   ).launch()

    # ── Example 5: Streamlit app ──────────────────────────────────────────────
    #
    #   import streamlit as st
    #   import numpy as np
    #
    #   @st.cache_resource
    #   def load_detector():
    #       return DualDetector(conf=0.60)
    #
    #   detector = load_detector()
    #   uploaded = st.file_uploader("Upload image")
    #   if uploaded:
    #       img    = Image.open(uploaded)
    #       result = detector.predict(img)
    #       st.image(detector.draw(result))
    #       st.json({"clothing":    result["clothing"],
    #                "accessories": result["accessories"]})