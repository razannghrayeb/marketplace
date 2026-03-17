#!/usr/bin/env python3
"""
Evaluate a Hugging Face YOLOS object-detection model on a YOLO-format test set.

Inputs:
- test images directory (e.g. /kaggle/working/df2_yolo/images/val)
- test labels directory (e.g. /kaggle/working/df2_yolo/labels/val)
- dataset YAML with class names (optional but recommended)
- optional JSON label map from model label -> dataset class id

Outputs (in --out-dir):
- metrics.json
- per_class_metrics.csv
- predictions.csv

Example:
python scripts/evaluate_hf_yolos.py \
  --model-id valentinafeve/yolos-fashionpedia \
  --images-dir /kaggle/working/df2_yolo/images/val \
  --labels-dir /kaggle/working/df2_yolo/labels/val \
  --data-yaml /kaggle/working/data.yaml \
  --label-map-json /kaggle/working/label_map.json \
  --out-dir /kaggle/working/yolos_eval
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import torch
import yaml
from PIL import Image
from transformers import pipeline


@dataclass
class Prediction:
    image_id: str
    class_id: int
    score: float
    box: Tuple[float, float, float, float]
    raw_label: str


@dataclass
class GroundTruth:
    image_id: str
    class_id: int
    box: Tuple[float, float, float, float]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate Hugging Face YOLOS on YOLO-format test labels")
    parser.add_argument("--model-id", required=True, help="Hugging Face model id, e.g. valentinafeve/yolos-fashionpedia")
    parser.add_argument("--images-dir", required=True, type=Path, help="Directory with test images")
    parser.add_argument("--labels-dir", required=True, type=Path, help="Directory with YOLO txt labels")
    parser.add_argument("--data-yaml", type=Path, default=None, help="Dataset data.yaml containing class names")
    parser.add_argument("--label-map-json", type=Path, default=None, help='JSON map: {"predicted_label": class_id}')
    parser.add_argument("--out-dir", type=Path, default=Path("hf_yolos_eval"), help="Output directory")
    parser.add_argument("--threshold", type=float, default=0.25, help="Confidence threshold for detector")
    parser.add_argument("--iou", type=float, default=0.5, help="IoU threshold for matching (AP50)")
    parser.add_argument("--max-images", type=int, default=None, help="Optional cap on number of evaluated images")
    parser.add_argument("--device", type=int, default=None, help="CUDA device index; defaults to 0 if available else CPU")
    return parser.parse_args()


def load_dataset_names(data_yaml: Path | None) -> Dict[int, str]:
    if data_yaml is None or not data_yaml.exists():
        return {}
    cfg = yaml.safe_load(data_yaml.read_text())
    names = cfg.get("names", {})
    if isinstance(names, list):
        return {idx: str(name) for idx, name in enumerate(names)}
    if isinstance(names, dict):
        return {int(k): str(v) for k, v in names.items()}
    return {}


def build_label_map(dataset_names: Dict[int, str], label_map_json: Path | None) -> Dict[str, int]:
    label_map: Dict[str, int] = {}

    if label_map_json and label_map_json.exists():
        raw = json.loads(label_map_json.read_text())
        label_map = {str(k).strip().lower(): int(v) for k, v in raw.items()}
        return label_map

    reverse = {name.strip().lower(): class_id for class_id, name in dataset_names.items()}
    return reverse


def xywhn_to_xyxy(xc: float, yc: float, bw: float, bh: float, width: int, height: int) -> Tuple[float, float, float, float]:
    x1 = (xc - bw / 2.0) * width
    y1 = (yc - bh / 2.0) * height
    x2 = (xc + bw / 2.0) * width
    y2 = (yc + bh / 2.0) * height
    return x1, y1, x2, y2


def box_iou(box_a: Tuple[float, float, float, float], box_b: Tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return inter_area / union


def voc_ap(recalls: List[float], precisions: List[float]) -> float:
    if not recalls:
        return 0.0

    mrec = [0.0] + recalls + [1.0]
    mpre = [0.0] + precisions + [0.0]

    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])

    ap = 0.0
    for i in range(len(mrec) - 1):
        if mrec[i + 1] != mrec[i]:
            ap += (mrec[i + 1] - mrec[i]) * mpre[i + 1]
    return ap


def load_ground_truth(labels_dir: Path, images_meta: Dict[str, Tuple[int, int]]) -> List[GroundTruth]:
    gts: List[GroundTruth] = []
    for image_id, (width, height) in images_meta.items():
        label_file = labels_dir / f"{image_id}.txt"
        if not label_file.exists():
            continue
        text = label_file.read_text().strip()
        if not text:
            continue

        for line in text.splitlines():
            parts = line.split()
            if len(parts) != 5:
                continue
            class_id = int(float(parts[0]))
            xc, yc, bw, bh = map(float, parts[1:])
            box = xywhn_to_xyxy(xc, yc, bw, bh, width, height)
            gts.append(GroundTruth(image_id=image_id, class_id=class_id, box=box))
    return gts


def run_predictions(
    model_id: str,
    image_paths: List[Path],
    label_map: Dict[str, int],
    threshold: float,
    device: int,
) -> List[Prediction]:
    detector = pipeline("object-detection", model=model_id, device=device)
    preds: List[Prediction] = []

    for idx, image_path in enumerate(image_paths, start=1):
        if idx % 50 == 0 or idx == 1 or idx == len(image_paths):
            print(f"Predicting {idx}/{len(image_paths)}")

        image = Image.open(image_path).convert("RGB")
        outputs = detector(image, threshold=threshold)

        for out in outputs:
            raw_label = str(out["label"]).strip()
            mapped = label_map.get(raw_label.lower())
            if mapped is None:
                continue
            box = out["box"]
            preds.append(
                Prediction(
                    image_id=image_path.stem,
                    class_id=mapped,
                    score=float(out["score"]),
                    box=(float(box["xmin"]), float(box["ymin"]), float(box["xmax"]), float(box["ymax"])),
                    raw_label=raw_label,
                )
            )

    return preds


def evaluate_ap50(
    preds: List[Prediction],
    gts: List[GroundTruth],
    class_ids: List[int],
    iou_thr: float,
) -> Dict[int, Dict[str, float]]:
    gts_by_class_img: Dict[int, Dict[str, List[Tuple[float, float, float, float]]]] = {cid: {} for cid in class_ids}
    for gt in gts:
        gts_by_class_img.setdefault(gt.class_id, {}).setdefault(gt.image_id, []).append(gt.box)

    preds_by_class: Dict[int, List[Prediction]] = {cid: [] for cid in class_ids}
    for pred in preds:
        if pred.class_id in preds_by_class:
            preds_by_class[pred.class_id].append(pred)

    metrics: Dict[int, Dict[str, float]] = {}

    for cid in class_ids:
        class_preds = sorted(preds_by_class.get(cid, []), key=lambda p: p.score, reverse=True)
        class_gts = gts_by_class_img.get(cid, {})
        npos = sum(len(v) for v in class_gts.values())

        matched: Dict[str, List[bool]] = {
            img_id: [False] * len(boxes) for img_id, boxes in class_gts.items()
        }

        tp: List[float] = []
        fp: List[float] = []

        for pred in class_preds:
            gt_boxes = class_gts.get(pred.image_id, [])
            if not gt_boxes:
                tp.append(0.0)
                fp.append(1.0)
                continue

            best_iou = 0.0
            best_idx = -1
            for idx, gt_box in enumerate(gt_boxes):
                iou = box_iou(pred.box, gt_box)
                if iou > best_iou:
                    best_iou = iou
                    best_idx = idx

            if best_iou >= iou_thr and best_idx >= 0 and not matched[pred.image_id][best_idx]:
                matched[pred.image_id][best_idx] = True
                tp.append(1.0)
                fp.append(0.0)
            else:
                tp.append(0.0)
                fp.append(1.0)

        cum_tp: List[float] = []
        cum_fp: List[float] = []
        running_tp = 0.0
        running_fp = 0.0
        for i in range(len(tp)):
            running_tp += tp[i]
            running_fp += fp[i]
            cum_tp.append(running_tp)
            cum_fp.append(running_fp)

        recalls = [x / npos if npos > 0 else 0.0 for x in cum_tp]
        precisions = [cum_tp[i] / (cum_tp[i] + cum_fp[i]) if (cum_tp[i] + cum_fp[i]) > 0 else 0.0 for i in range(len(cum_tp))]
        ap50 = voc_ap(recalls, precisions)

        total_tp = cum_tp[-1] if cum_tp else 0.0
        total_fp = cum_fp[-1] if cum_fp else 0.0
        total_fn = float(npos) - total_tp
        precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
        recall = total_tp / float(npos) if npos > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        metrics[cid] = {
            "ap50": ap50,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "tp": total_tp,
            "fp": total_fp,
            "fn": total_fn,
            "gt_count": float(npos),
            "pred_count": float(len(class_preds)),
        }

    return metrics


def save_outputs(
    out_dir: Path,
    dataset_names: Dict[int, str],
    preds: List[Prediction],
    class_metrics: Dict[int, Dict[str, float]],
    summary: Dict[str, float],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    with (out_dir / "predictions.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["image_id", "class_id", "class_name", "score", "xmin", "ymin", "xmax", "ymax", "raw_label"])
        for p in preds:
            writer.writerow(
                [
                    p.image_id,
                    p.class_id,
                    dataset_names.get(p.class_id, str(p.class_id)),
                    f"{p.score:.6f}",
                    f"{p.box[0]:.2f}",
                    f"{p.box[1]:.2f}",
                    f"{p.box[2]:.2f}",
                    f"{p.box[3]:.2f}",
                    p.raw_label,
                ]
            )

    with (out_dir / "per_class_metrics.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["class_id", "class_name", "ap50", "precision", "recall", "f1", "tp", "fp", "fn", "gt_count", "pred_count"])
        for class_id, metric in sorted(class_metrics.items()):
            writer.writerow(
                [
                    class_id,
                    dataset_names.get(class_id, str(class_id)),
                    f"{metric['ap50']:.6f}",
                    f"{metric['precision']:.6f}",
                    f"{metric['recall']:.6f}",
                    f"{metric['f1']:.6f}",
                    f"{metric['tp']:.1f}",
                    f"{metric['fp']:.1f}",
                    f"{metric['fn']:.1f}",
                    f"{metric['gt_count']:.1f}",
                    f"{metric['pred_count']:.1f}",
                ]
            )

    (out_dir / "metrics.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()

    if not args.images_dir.exists():
        raise FileNotFoundError(f"Images directory not found: {args.images_dir}")
    if not args.labels_dir.exists():
        raise FileNotFoundError(f"Labels directory not found: {args.labels_dir}")

    image_paths = sorted(
        [*args.images_dir.glob("*.jpg"), *args.images_dir.glob("*.jpeg"), *args.images_dir.glob("*.png")]
    )
    if not image_paths:
        raise RuntimeError(f"No images found in {args.images_dir}")
    if args.max_images is not None:
        image_paths = image_paths[: args.max_images]

    print(f"Images: {len(image_paths)}")

    device = args.device
    if device is None:
        device = 0 if torch.cuda.is_available() else -1

    dataset_names = load_dataset_names(args.data_yaml)
    label_map = build_label_map(dataset_names, args.label_map_json)

    if not label_map:
        print("⚠ No label map provided and no class names available from data.yaml.")
        print("  Add --label-map-json to map model labels to dataset class ids.")

    images_meta: Dict[str, Tuple[int, int]] = {}
    for image_path in image_paths:
        with Image.open(image_path) as img:
            images_meta[image_path.stem] = img.size

    print("Loading ground-truth labels...")
    gts = load_ground_truth(args.labels_dir, images_meta)
    print(f"Ground-truth boxes: {len(gts)}")

    print(f"Running predictions with model: {args.model_id}")
    preds = run_predictions(
        model_id=args.model_id,
        image_paths=image_paths,
        label_map=label_map,
        threshold=args.threshold,
        device=device,
    )
    print(f"Mapped predictions: {len(preds)}")

    class_ids = sorted({gt.class_id for gt in gts})
    if not class_ids:
        raise RuntimeError("No valid ground-truth classes found in labels.")

    class_metrics = evaluate_ap50(preds=preds, gts=gts, class_ids=class_ids, iou_thr=args.iou)

    mean_ap50 = sum(m["ap50"] for m in class_metrics.values()) / len(class_metrics)
    total_tp = sum(m["tp"] for m in class_metrics.values())
    total_fp = sum(m["fp"] for m in class_metrics.values())
    total_fn = sum(m["fn"] for m in class_metrics.values())
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    summary = {
        "model_id": args.model_id,
        "images_dir": str(args.images_dir),
        "labels_dir": str(args.labels_dir),
        "num_images": len(image_paths),
        "num_gt_boxes": len(gts),
        "num_mapped_predictions": len(preds),
        "threshold": args.threshold,
        "iou_threshold": args.iou,
        "mAP50": mean_ap50,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }

    save_outputs(
        out_dir=args.out_dir,
        dataset_names=dataset_names,
        preds=preds,
        class_metrics=class_metrics,
        summary=summary,
    )

    print("\n" + "=" * 60)
    print("EVALUATION COMPLETE")
    print("=" * 60)
    print(f"mAP50    : {summary['mAP50']:.4f}")
    print(f"Precision: {summary['precision']:.4f}")
    print(f"Recall   : {summary['recall']:.4f}")
    print(f"F1       : {summary['f1']:.4f}")
    print(f"Outputs  : {args.out_dir}")


if __name__ == "__main__":
    main()
