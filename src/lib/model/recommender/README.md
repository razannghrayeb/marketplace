Recommender training scaffold

This folder contains a minimal scaffold to train a fashion recommender using a pretrained ResNet backbone and a multi-label attribute head + embedding head.

Quickstart

1. Install dependencies (prefer a venv):

```bash
pip install -r src/lib/model/recommender/requirements-recommender.txt
```

2. Prepare a CSV with columns `image_path` (local path), `labels` (semicolon-separated attributes). For ASOS, use `asos_downloader.py` to fetch images and then create the CSV mapping images to attributes.

3. Train:

```bash
python -m src.lib.model.recommender.train --csv data/my_dataset.csv --image-root data/asos_images --output-dir models/recommender --epochs 20
```

Notes

- Embedding training currently uses a batch InfoNCE placeholder; for best results provide positive pairs (outfit membership) and implement a sampler that yields positive/negative pairs.
- Respect ASOS terms of service when downloading images; prefer licensed datasets when possible.
