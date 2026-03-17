"""
Download all ML models from HuggingFace Hub into the local models/ directory.

The canonical model store is: https://huggingface.co/razangh/fashion-models

Usage
-----
  python scripts/download-models.py               # download everything
  python scripts/download-models.py --dry-run     # list files without downloading
  python scripts/download-models.py --token <tok>  # use HF token (private repo)

Environment variables
---------------------
  HF_TOKEN   HuggingFace access token (alternative to --token flag)

Models downloaded
-----------------
  fashion-clip-image.onnx          FashionCLIP image encoder  (512-dim)
  fashion-clip-text.onnx           FashionCLIP text encoder   (512-dim)
  clip-image-vit-32.onnx           CLIP ViT-B/32 image encoder
  clip-image-vit-l-14.onnx         CLIP ViT-L/14 image encoder
  blip-vision.onnx                 BLIP image captioning vision encoder
  blip-text-decoder.onnx           BLIP text decoder
  xgb_ranker_model.json            XGBoost ranker weights
  ranker_model_metadata.json       Ranker feature metadata
  attribute_extractor/             Attribute extraction model directory
"""

import argparse
import os
import sys

HF_REPO_ID = "razangh/fashion-models"
LOCAL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download ML models from HuggingFace")
    parser.add_argument("--token", default=None, help="HuggingFace access token")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List files in the repo without downloading",
    )
    args = parser.parse_args()

    token = args.token or os.environ.get("HF_TOKEN")

    try:
        from huggingface_hub import list_repo_files, snapshot_download
    except ImportError:
        print("ERROR: huggingface_hub is not installed.")
        print("  pip install huggingface_hub")
        sys.exit(1)

    if args.dry_run:
        print(f"Files in {HF_REPO_ID}:\n")
        for f in sorted(list_repo_files(HF_REPO_ID, repo_type="model", token=token)):
            print(f"  {f}")
        return

    local_dir = os.path.abspath(LOCAL_DIR)
    print(f"Downloading models from {HF_REPO_ID}")
    print(f"Destination: {local_dir}\n")

    downloaded = snapshot_download(
        repo_id=HF_REPO_ID,
        repo_type="model",
        local_dir=local_dir,
        token=token,
        # Ignore HuggingFace metadata files
        ignore_patterns=["*.gitattributes", ".gitattributes", "README.md"],
    )

    print(f"\nModels ready at: {downloaded}")


if __name__ == "__main__":
    main()
