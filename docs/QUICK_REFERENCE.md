# 🚀 Quick Reference: All Search Features

## Which Search Should I Use?

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DECISION TREE                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  How many INPUT images do you have?                                 │
│                                                                       │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐            │
│  │  1 image │         │  1 image │         │ Multiple │            │
│  │          │         │  with    │         │  images  │            │
│  │  (simple)│         │ multiple │         │  (1-5)   │            │
│  │          │         │  items   │         │          │            │
│  └─────┬────┘         └─────┬────┘         └─────┬────┘            │
│        │                    │                    │                  │
│        ▼                    ▼                    ▼                  │
│  NORMAL SEARCH       YOLO DETECTION      MULTI-IMAGE                │
│  /api/search/image   /api/images/search  /api/search/multi-image   │
│                                                                       │
│  "Find similar"      "Shop the look"    "Mix attributes"           │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Quick Reference Table

| I want to... | Use | Endpoint |
|--------------|-----|----------|
| Find products like this one image | **Normal Search** | `POST /api/search/image` |
| Find items for each product in an outfit photo | **YOLO Detection** | `POST /api/images/search` |
| Mix color from one image with style from another | **Multi-Image** | `POST /api/search/multi-image` |
| Manually control attribute weights | **Multi-Vector** | `POST /api/search/multi-vector` |
| Complete a product / finish an outfit with curated suggestions | **Complete My Style** | `GET /api/products/:id/complete-style` `POST /api/products/complete-style` |
| Search by text/keywords | **Text Search** | `GET /api/search?q=...` |

---

## ⚡ Quick Examples

### 1. Normal Search
```bash
curl -X POST http://localhost:3000/api/search/image \
  -F "image=@dress.jpg" \
  -F "limit=20"
```

### 2. YOLO Detection (Shop the Look)
```bash
curl -X POST http://localhost:3000/api/images/search \
  -F "image=@outfit.jpg" \
  -F "limit_per_item=10"
```

### 3. Multi-Image Composite
```bash
curl -X POST http://localhost:3000/api/search/multi-image \
  -F "images=@red_dress.jpg" \
  -F "images=@leather_jacket.jpg" \
  -F "prompt=Red color from first, leather texture from second"
```

---

## 🎯 Use Case Examples

### Scenario: "I like this dress, find me similar ones"
**Solution**: Normal Search
```bash
POST /api/search/image
Body: image=dress.jpg
```

---

### Scenario: "I saw an outfit on Instagram, want to buy each piece"
**Solution**: YOLO Detection
```bash
POST /api/images/search
Body: image=instagram_outfit.jpg
```

---

### Scenario: "I want the red color from this dress but leather texture from this jacket"
**Solution**: Multi-Image Composite
```bash
POST /api/search/multi-image
Body:
  images=[red_dress.jpg, leather_jacket.jpg]
  prompt="Red color from first, leather texture from second"
```

---

### Scenario: "Mix vintage style from this coat with modern fit from this blazer, under $200"
**Solution**: Multi-Image Composite with Price
```bash
POST /api/search/multi-image
Body:
  images=[vintage_coat.jpg, modern_blazer.jpg]
  prompt="Vintage style from first, modern fit from second, under $200"
```

---

## 📊 Feature Matrix

| Feature | Normal | YOLO | Multi-Image |
|---------|--------|------|-------------|
| **Images** | 1 | 1 | 1-5 |
| **Prompt** | ❌ | ❌ | ✅ |
| **Detection** | ❌ | ✅ | ❌ |
| **Mix Attributes** | ❌ | ❌ | ✅ |
| **AI Intent** | ❌ | ❌ | ✅ |
| **Speed** | ⚡⚡⚡ | ⚡⚡ | ⚡⚡ |
| **Complexity** | Simple | Medium | Advanced |

---

## 🔑 Key Parameters

### Normal Search (`/api/search/image`)
```
image: File (required)
limit: Number (default: 50)
```

### YOLO Detection (`/api/images/search`)
```
image: File (required)
confidence: 0-1 (default: 0.25)
threshold: 0-1 (default: 0.7)
limit_per_item: Number (default: 10)
```

### Multi-Image Composite (`/api/search/multi-image`)
```
images: File[] (1-5, required)
prompt: String (required)
limit: Number (default: 50)
rerankWeights: JSON (optional)
  {
    "vectorWeight": 0.6,
    "attributeWeight": 0.3,
    "priceWeight": 0.1,
    "recencyWeight": 0.0
  }
```

---

## 💡 Pro Tips

### Normal Search
- ✅ Use high-quality images
- ✅ Single item per image works best
- ✅ Good lighting improves results

### YOLO Detection
- ✅ Clear item separation
- ✅ Avoid cluttered backgrounds
- ✅ Works with 1-10 items per image
- ✅ Adjust confidence for sensitivity

### Multi-Image Composite
- ✅ Be specific: "first image", "second image"
- ✅ Order matters: first = index 0
- ✅ Mention exact attributes: color, texture, style, material, pattern
- ✅ Max 5 images for best performance
- ✅ Natural language: "I want...", "Mix..."

---

## 🚨 Common Mistakes

### ❌ Wrong: Using multi-image for single image similarity
```bash
# Don't do this:
POST /api/search/multi-image
  images=[single_dress.jpg]
  prompt="Find similar"
```
**✅ Use instead**: `POST /api/search/image`

---

### ❌ Wrong: Using normal search for outfit shopping
```bash
# Don't do this for outfits:
POST /api/search/image
  image=outfit_with_dress_shoes_bag.jpg
```
**✅ Use instead**: `POST /api/images/search` (YOLO Detection)

---

### ❌ Wrong: Missing prompt in multi-image
```bash
# This will fail:
POST /api/search/multi-image
  images=[dress1.jpg, dress2.jpg]
  # Missing prompt!
```
**✅ Add prompt**: `prompt="Color from first, style from second"`

---

## 📱 Response Examples

### Normal Search Response
```json
{
  "results": [...],
  "total": 147,
  "tookMs": 45
}
```

### YOLO Detection Response
```json
{
  "detection": {
    "items": [...],
    "count": 3
  },
  "similarProducts": {
    "byDetection": [...]
  }
}
```

### Multi-Image Response
```json
{
  "results": [...],
  "total": 147,
  "tookMs": 234,
  "explanation": "Found products matching...",
  "rerankBreakdown": {
    "vector": 0.52,
    "attribute": 0.27,
    "price": 0.09,
    "recency": 0.03
  }
}
```

---

## 📚 Documentation Links

- **[Complete Guide](./SEARCH_FEATURES_GUIDE.md)** - Full documentation with examples
- **[API Reference](./api-reference.md#search-api)** - Detailed API specs
- **[Implementation Summary](./SEARCH_IMPLEMENTATION_SUMMARY.md)** - Technical details
- **[Multi-Vector Deep Dive](./multi-vector-search.md)** - Advanced architecture

---

## ⚙️ Setup Commands

```bash
# Recreate index with per-attribute fields
npx tsx scripts/recreate-opensearch-index.ts

# Backfill embeddings for existing products
npx tsx scripts/generate-attribute-embeddings.ts --batch-size=100

# Test multi-vector search
npx tsx scripts/test-multi-vector-search.ts
```

---

## 🎉 Quick Start

1. **Start with Normal Search** for simple use cases
2. **Use YOLO Detection** when you have outfit/lookbook images
3. **Upgrade to Multi-Image** when you need attribute mixing

All three are production-ready and documented! 🚀

---

**Need help?** Check [SEARCH_FEATURES_GUIDE.md](./SEARCH_FEATURES_GUIDE.md) for detailed examples.
