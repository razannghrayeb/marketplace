docker-compose up -d
## Image Analysis API

Overview

The Image Analysis API provides a unified entry point for image upload, object detection, embedding generation and image-based product search.

Key capabilities:

- Image storage to R2/CDN
- Image validation and pHash
- CLIP embeddings for semantic image similarity
- YOLOv8 object detection for fashion items
- Grouped similar-product search per detected object (new)

Quick start — which endpoint to call

| Scenario | Endpoint |
|---|---|
| Upload and find similar products (recommended) | `POST /api/images/search` — detects objects, crops each, finds similar products per object |
| Full analysis and store | `POST /api/images/analyze` — store + embed + detect |
| Detect only | `POST /api/images/detect` |
| Detection from URL | `POST /api/images/detect/url` |
| Batch detection | `POST /api/images/detect/batch` |

Endpoints (high level)

- `GET /api/images/status` — service availability
- `GET /api/images/labels` — supported fashion categories
- `POST /api/images/analyze` — full pipeline (store + embed + detect)
- `POST /api/images/search` — MAIN: detect objects then return similar products grouped by detection
- `POST /api/images/search/url` — same as `/search` but from an image URL
- `POST /api/images/detect` — quick detection only
- `POST /api/images/detect/batch` — batch detection (up to 10 files)

Main flow for `POST /api/images/search`

1. Validate image
2. Run YOLOv8 detection to find clothing items and bounding boxes
3. For each detected object (or one representative per label):
   - Crop the image region for that bounding box
   - Generate a CLIP embedding for the crop
   - Run k-NN search in OpenSearch using the embedding (optionally filter by mapped product category)
4. Aggregate and return results grouped by detection

Request example (shop-by-image):

```bash
curl -X POST "http://localhost:4000/api/images/search?limit_per_item=10&threshold=0.7" \
  -F "image=@outfit.jpg"
```

Response (trimmed):

```json
{
  "success": true,
  "detection": {
    "items": [ { "label": "dress", "confidence": 0.92 }, { "label": "heels", "confidence": 0.87 } ],
    "count": 2
  },
  "similarProducts": {
    "byDetection": [
      {
        "detection": { "label": "dress", "confidence": 0.92, "box": {...} },
        "category": "dresses",
        "products": [ { "id": 123, "title": "Floral Midi Dress", "similarity_score": 0.89 } ],
        "count": 10
      },
      {
        "detection": { "label": "heels", "confidence": 0.87, "box": {...} },
        "category": "footwear",
        "products": [ { "id": 456, "title": "Strappy Heels", "similarity_score": 0.82 } ],
        "count": 8
      }
    ],
    "totalProducts": 18,
    "threshold": 0.7,
    "detectedCategories": ["dress", "heels"]
  }
}
```

Notes & recommendations

- Default similarity threshold is `0.7`. Lower values return more results but with lower fidelity.
- The API crops each detected object and performs per-object similarity — this produces more relevant matches (e.g., shoes → shoes, dresses → dresses).
- To speed up results, consider running detection and embedding in parallel and limiting per-detection searches (`limit_per_item`).

Integration example (JS):

```ts
const fd = new FormData();
fd.append('image', file);
const res = await fetch('/api/images/search?limit_per_item=8', { method: 'POST', body: fd });
const json = await res.json();
// use json.similarProducts.byDetection
```

Running services

```bash
docker-compose up -d
```

Errors

- 400: missing image or invalid payload
- 413: file too large (>10MB)
- 503: model/service unavailable (run model services and download CLIP models)

