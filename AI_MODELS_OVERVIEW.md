# 🤖 AI Models Overview & Improvement Roadmap

## 📊 Project Scope

**Fashion Aggregator API** - A sophisticated fashion marketplace that uses multiple AI/ML models to enable:
- Visual similarity search (image-to-product matching)
- Multi-image `pnpm install
pnpm dev` search (combine attributes from multiple images)
- Object detection (identify fashion items in photos)
- Semantic text search (natural language understanding)
- Product ranking and recommendations
- Attribute extraction (color, material, style, etc.)

---

## 🔍 Current AI Models in Use

### 1. **CLIP (Contrastive Language-Image Pre-training)** ✅

**Purpose**: Visual similarity search and multimodal embeddings

**Models Available**:
- **Fashion-CLIP** (ViT-B/32 fine-tuned) - 512-dim - **RECOMMENDED**
- **ViT-L/14** - 768-dim - Higher accuracy
- **ViT-B/32** - 512-dim - Legacy baseline

**Current Implementation**:
- ✅ ONNX format for fast inference
- ✅ Image embeddings (224×224 input)
- ✅ Text embeddings (77 tokens max)
- ✅ Multi-vector search (separate embeddings for color, texture, style, material, pattern)
- ✅ Batch processing support
- ✅ L2 normalization
- ✅ Redis caching for embeddings

**Files**:
- `src/lib/image/clip.ts` - CLIP service
- `models/fashion-clip-image.onnx` - Image model
- `models/fashion-clip-text.onnx` - Text model

**Strengths**:
- ✅ Good visual similarity matching
- ✅ Multimodal (text + image)
- ✅ Fine-tuned for fashion domain
- ✅ Fast inference with ONNX

**Weaknesses & Missing Features**:
- ❌ **No fine-tuning on your specific dataset** - Using pre-trained weights only
- ❌ **Limited attribute understanding** - Struggles with specific attributes like "v-neck" vs "round neck"
- ❌ **No continuous learning** - Model doesn't improve from user interactions
- ❌ **Fashion-CLIP may not be optimally calibrated** for your specific product categories
- ❌ **No ensemble approach** - Single model, no fallbacks

---

### 2. **YOLOv8 (Object Detection)** ⚠️

**Purpose**: Detect fashion items in images (for "shop the look" feature)

**Current Implementation**:
- ✅ FastAPI service (`src/lib/model/yolov8_api.py`)
- ✅ TypeScript client (`src/lib/image/yolov8Client.ts`)
- ✅ Detection categories: shirts, pants, dresses, shoes, bags, jackets, etc.
- ✅ Bounding box extraction
- ✅ Style inference per item (occasion, formality)
- ✅ Confidence thresholding

**Files**:
- `src/lib/model/yolov8_api.py` - Python API server
- `src/lib/image/yolov8Client.ts` - TypeScript client
- `models/yolov8-fashion.pt` (expected, may not exist)

**Strengths**:
- ✅ Real-time detection
- ✅ Multiple item detection per image
- ✅ Good accuracy for common fashion items

**Critical Weaknesses**:
- ❌ **Model file may not exist** - References `models/yolov8-fashion.pt` which isn't in your repo
- ❌ **No custom training** - Using generic YOLO, not fine-tuned on fashion datasets
- ❌ **Limited fashion categories** - Only ~11 basic categories
- ❌ **No accessory details** - Missing jewelry, watches, sunglasses, belts
- ❌ **No pose awareness** - Struggles with complex poses/angles
- ❌ **No segmentation** - Only bounding boxes, not pixel-level masks
- ❌ **Fashion-specific datasets not used** (DeepFashion2, ModaNet, Fashionpedia)

---

### 3. **XGBoost Ranker** ⚠️

**Purpose**: Re-rank product recommendations based on multiple features

**Current Implementation**:
- ✅ 25 features (CLIP sim, text sim, style scores, price ratio, etc.)
- ✅ Feature engineering pipeline (`src/lib/ranker/features.ts`)
- ✅ Ranking pipeline (`src/lib/ranker/pipeline.ts`)
- ✅ Fallback to heuristic scoring
- ✅ Python FastAPI service for inference

**Features Used**:
```
- clip_sim, text_sim, opensearch_score
- phash_dist, phash_sim
- style_score, color_score, formality_score, occasion_score
- price_ratio, same_brand, same_vendor
- category compatibility scores
```

**Files**:
- `src/lib/ranker/pipeline.ts` - Ranking orchestration
- `src/lib/ranker/features.ts` - Feature extraction
- `models/xgb_ranker_model.json` - Model weights
- `models/ranker_model_metadata.json` - Feature names

**Strengths**:
- ✅ Multi-signal ranking
- ✅ Fast inference
- ✅ Interpretable features

**Critical Weaknesses**:
- ❌ **Dummy model** - `ranker_model_metadata.json` says "Dummy ranker model for testing"
- ❌ **No training data** - No labeled user interaction data for training
- ❌ **No A/B testing** - Can't measure ranking quality improvements
- ❌ **Missing features**:
  - User behavior signals (click-through rate, dwell time)
  - Contextual features (time of day, season, location)
  - Personalization (user history, preferences)
  - Cross-feature interactions
- ❌ **No online learning** - Model doesn't update with new data
- ❌ **No diversity in results** - May produce repetitive recommendations

---

### 4. **Attribute Extractor** ❌ NOT IMPLEMENTED

**Purpose**: Extract fashion attributes (color, material, pattern, season, occasion)

**Current State**:
- ⚠️ **Config file exists** (`models/attribute_extractor/config.json`)
- ⚠️ **Training code exists** (`src/lib/model/inference.py`)
- ❌ **No trained model** - Model file doesn't exist
- ❌ **Not integrated** - Not used in the API

**Planned Attributes**:
```json
{
  "categories": 13 classes (shirt, dress, pants, etc.),
  "colors": 12 classes (red, blue, black, etc.),
  "patterns": 8 classes (solid, striped, floral, etc.),
  "materials": 10 classes (cotton, leather, denim, etc.),
  "seasons": 5 classes (spring, summer, fall, winter, all-season),
  "occasions": 8 classes (casual, formal, party, sports, etc.)
}
```

**Architecture**: MobileNetV3 (efficient CNN for mobile deployment)

**Critical Issues**:
- ❌ **Completely missing** - Only config and training skeleton exist
- ❌ **No dataset** - Requires labeled fashion dataset (DeepFashion2)
- ❌ **No training pipeline** - Code incomplete
- ❌ **High value feature** - Would greatly improve search accuracy

---

### 5. **Query Processor** ✅ (Rule-Based + LLM Fallback)

**Purpose**: Normalize, correct, and expand search queries

**Current Implementation**:
- ✅ Arabizi → Arabic transliteration
- ✅ Spell correction (Levenshtein distance)
- ✅ Brand/category recognition
- ✅ Gender/color filter extraction
- ✅ LLM fallback (Gemini) for complex queries
- ✅ Query caching

**Files**:
- `src/lib/queryProcessor/index.ts` - Main pipeline
- `src/lib/queryProcessor/spellCorrector.ts` - Spell checker
- `src/lib/queryProcessor/arabizi.ts` - Arabic/Arabizi handling
- `src/lib/queryProcessor/dictionary.ts` - Fashion vocabulary

**Strengths**:
- ✅ Multi-language support (English, Arabic, Arabizi)
- ✅ Fashion-specific vocabulary
- ✅ Fast rule-based processing

**Weaknesses**:
- ❌ **Limited semantic understanding** - Rule-based, not learned
- ❌ **No query expansion model** - Could benefit from Word2Vec/BERT
- ❌ **LLM fallback is expensive** - Uses Gemini API (costs money)
- ❌ **No query intent classification model** - Could use lightweight BERT classifier

---

### 6. **Multi-Vector Composite Search** ✅

**Purpose**: Search using multiple images + natural language prompt

**Current Implementation**:
- ✅ Attribute-specific embeddings (color, texture, style, material, pattern)
- ✅ Intent parser (Gemini API)
- ✅ Weighted embedding merge
- ✅ Per-attribute kNN search
- ✅ Filter extraction from natural language

**Files**:
- `src/lib/query/compositeQueryBuilder.ts` - Query builder
- `src/lib/query/queryMapper.ts` - Maps to OpenSearch/SQL
- `docs/IMPLEMENTATION_COMPLETE.md` - Full spec

**Strengths**:
- ✅ Unique feature (not common in fashion search)
- ✅ Flexible attribute mixing
- ✅ Natural language interface

**Weaknesses**:
- ❌ **Depends on external LLM** - Gemini API costs + latency
- ❌ **No evaluation dataset** - Hard to measure quality
- ❌ **Prompt engineering needed** - Gemini results depend on prompt quality

---

## 🚨 Critical Missing Components

### 1. **No Training Infrastructure** ⚠️⚠️⚠️
- ❌ No model training pipelines (except skeleton code)
- ❌ No labeled datasets for fine-tuning
- ❌ No experiment tracking (MLflow, Weights & Biases)
- ❌ No model versioning
- ❌ No A/B testing framework

### 2. **No User Feedback Loop** ⚠️⚠️⚠️
- ❌ No click-through rate tracking
- ❌ No purchase conversion tracking
- ❌ No explicit feedback (thumbs up/down)
- ❌ No model retraining based on user behavior
- ❌ Data collection exists (`recommendation_impressions` table) but not used for training

### 3. **No Model Monitoring** ⚠️⚠️
- ❌ No accuracy/performance metrics logged
- ❌ No drift detection
- ❌ No latency monitoring
- ❌ No error rate tracking
- ❌ No model health dashboard

### 4. **No Personalization** ⚠️
- ❌ No user profile embeddings
- ❌ No collaborative filtering
- ❌ No session-based recommendations
- ❌ All users get same results for same query

### 5. **Limited Fashion Domain Knowledge** ⚠️
- ❌ No outfit compatibility model (what goes with what)
- ❌ No style transfer (find this item in different style)
- ❌ No trend detection
- ❌ No seasonal recommendations

---

## 🎯 Improvement Priorities (Ranked by Impact)

### 🔥 Priority 1: CRITICAL - Train XGBoost Ranker

**Why**: Currently using a dummy model. Ranking is critical for UX.

**Action Items**:
1. ✅ Collect training data (you have `recommendation_impressions` table)
2. Label data:
   - Click = positive signal (weight: 1.0)
   - Purchase = strong positive (weight: 3.0)
   - No interaction = negative (weight: -0.5)
3. Train model with proper train/val/test split
4. Hyperparameter tuning (max_depth, learning_rate, n_estimators)
5. Implement NDCG/MAP evaluation
6. Deploy trained model

**Expected Impact**: 📈 +20-30% improvement in click-through rate

**Effort**: Medium (2-3 weeks)

**Files to Update**:
- `scripts/train_xgboost_ranker.py` (new)
- `src/lib/ranker/client.ts` (point to new model)

---

### 🔥 Priority 2: CRITICAL - Train/Deploy YOLOv8 Fashion Detector

**Why**: Current model may not exist or is generic.

**Action Items**:
1. **Obtain fashion dataset**:
   - DeepFashion2 (best, 491k images, 13 categories, 801k items)
   - OR ModaNet (55k images, 13 categories)
   - OR Fashionpedia (48k images, 27 categories, 56 fine-grained attributes)
2. Fine-tune YOLOv8 (medium or large variant)
3. Train for ~100 epochs with augmentation
4. Export to ONNX for fast inference
5. Add more categories (accessories, jewelry, sunglasses, belts)
6. Evaluate on test set (mAP@0.5, mAP@0.75)

**Expected Impact**: 📈 +40% detection accuracy, support for 25+ categories

**Effort**: High (3-4 weeks)

**Training Code**:
```python
from ultralytics import YOLO

# Load pretrained model
model = YOLO('yolov8l.pt')  # Large variant for accuracy

# Fine-tune on fashion dataset
results = model.train(
    data='deepfashion2.yaml',
    epochs=100,
    imgsz=640,
    batch=16,
    patience=20,
    device=0  # GPU
)

# Export to ONNX
model.export(format='onnx')
```

---

### 🔥 Priority 3: HIGH - Train Attribute Extractor

**Why**: Missing entirely. Would enable filter-based search and better recommendations.

**Action Items**:
1. Get DeepFashion2 dataset (includes attributes)
2. Preprocess data:
   - Extract crops using YOLO detections
   - Clean/normalize attribute labels
3. Train MobileNetV3 multi-head model
4. Export to ONNX
5. Integrate into image analysis pipeline
6. Add attributes to product index

**Expected Impact**: 📈 +30% search relevance, enable "leather jacket" vs "denim jacket" queries

**Effort**: High (4-5 weeks)

**Architecture**:
```python
class AttributeExtractor(nn.Module):
    def __init__(self):
        self.backbone = mobilenet_v3_small(pretrained=True)
        self.category_head = nn.Linear(576, 13)      # 13 categories
        self.color_head = nn.Linear(576, 12)         # 12 colors (multi-label)
        self.pattern_head = nn.Linear(576, 8)        # 8 patterns
        self.material_head = nn.Linear(576, 10)      # 10 materials
        self.season_head = nn.Linear(576, 5)         # 5 seasons (multi-label)
        self.occasion_head = nn.Linear(576, 8)       # 8 occasions (multi-label)
```

---

### Priority 4: HIGH - Fine-tune CLIP on Your Data

**Why**: Pre-trained CLIP doesn't know your specific products/categories.

**Action Items**:
1. Create training pairs:
   - Product images + descriptions (you have this!)
   - User queries + clicked products (from logs)
2. Fine-tune Fashion-CLIP using contrastive learning
3. Evaluate on held-out test set
4. Compare before/after retrieval metrics

**Expected Impact**: 📈 +15-20% retrieval accuracy

**Effort**: High (4-6 weeks)

**Training Approach**:
- Use existing `train_clip.py` as starting point
- Add product image-text pairs
- Train with InfoNCE loss
- Use learning rate warmup
- Monitor validation similarity metrics

---

### Priority 5: MEDIUM - Implement User Feedback Loop

**Why**: Models never improve without real-world feedback.

**Action Items**:
1. Log search queries + results + clicks + purchases
2. Create training data pipeline:
   ```sql
   SELECT 
     query,
     product_id,
     clicked,
     purchased,
     dwell_time_seconds
   FROM recommendation_impressions
   WHERE created_at > NOW() - INTERVAL '30 days'
   ```
3. Retrain ranker weekly with new data
4. A/B test new models vs current model
5. Auto-deploy if metrics improve

**Expected Impact**: 📈 Continuous improvement, +5-10% lift per iteration

**Effort**: Medium (3-4 weeks)

---

### Priority 6: MEDIUM - Add Personalization

**Why**: All users get same results. Personalization = better UX.

**Action Items**:
1. Build user embedding model (history → vector)
2. Collaborative filtering (users who viewed X also viewed Y)
3. Session-based recommendations (RNN/Transformer)
4. Add user context features to ranker:
   - Past purchases
   - Browsing history
   - Size preferences
   - Price sensitivity

**Expected Impact**: 📈 +10-15% conversion rate

**Effort**: High (6-8 weeks)

---

### Priority 7: LOW - Replace Gemini with Local LLM

**Why**: Reduce costs, latency, and external dependencies.

**Action Items**:
1. Deploy local LLM (LLaMA 3.1 8B or Mistral 7B)
2. Fine-tune on fashion queries
3. Replace Gemini calls in:
   - Query processor (`llmRewriter.ts`)
   - Intent parser (`compositeQueryBuilder.ts`)
4. Use vLLM for fast inference

**Expected Impact**: 💰 Cost reduction, 📉 -50ms latency

**Effort**: Medium (2-3 weeks)

---

### Priority 8: LOW - Outfit Compatibility Model

**Why**: Enable "complete the outfit" feature with ML instead of rules.

**Action Items**:
1. Collect outfit datasets (Polyvore, Fashion-Gen)
2. Train compatibility model (Siamese network or Transformer)
3. Learn item-item compatibility scores
4. Use for outfit completion endpoint

**Expected Impact**: 📈 +20% outfit completion accuracy

**Effort**: High (5-6 weeks)

---

## 📈 Success Metrics to Track

### Model Performance
- **CLIP Retrieval**: Recall@10, Recall@50, MRR
- **YOLOv8 Detection**: mAP@0.5, mAP@0.75, category accuracy
- **XGBoost Ranker**: NDCG@10, MAP, MRR
- **Attribute Extractor**: Per-attribute F1 score, overall accuracy

### Business Metrics
- **Click-through rate (CTR)**: % of searches that result in clicks
- **Conversion rate**: % of searches that result in purchases
- **Average dwell time**: How long users view products
- **Search exit rate**: % of users leaving after search
- **Query reformulation rate**: % of users refining their query

### System Metrics
- **Latency**: p50, p95, p99 inference time
- **Error rate**: % of failed model calls
- **Model drift**: Distribution shift over time
- **Cost per query**: Infrastructure + API costs

---

## 🛠️ Recommended Tools & Infrastructure

### Training & Experimentation
- **MLflow**: Experiment tracking, model registry
- **Weights & Biases**: Hyperparameter tuning, visualization
- **DVC**: Dataset versioning

### Model Deployment
- **ONNX Runtime**: Fast CPU/GPU inference (already using)
- **TorchServe**: Serve PyTorch models (for YOLOv8)
- **vLLM**: Fast LLM inference (for local Gemini replacement)
- **Triton Inference Server**: Unified serving for all models

### Monitoring
- **Prometheus + Grafana**: Metrics dashboard
- **Evidently AI**: ML monitoring, drift detection
- **Sentry**: Error tracking

### Data Collection
- **Mixpanel/Amplitude**: User behavior analytics
- **PostHog**: Product analytics + feature flags

---

## 💡 Quick Wins (Low Effort, High Impact)

1. **Collect training data NOW** ✅
   - Log all search queries, clicks, purchases
   - Even if you don't train immediately, start collecting

2. **Fix YOLOv8 model** ⚠️
   - Check if `models/yolov8-fashion.pt` exists
   - If not, download pre-trained YOLOv8 and use temporarily

3. **Add basic monitoring** 📊
   - Log CLIP/ranker inference times
   - Track search API response times
   - Set up alerts for errors

4. **Create evaluation dataset** 📝
   - Manually label 100-200 query-product pairs
   - Use for regression testing when updating models

5. **Enable CLIP caching** ✅ (already done)
   - You have Redis caching - make sure it's used

---

## 🎬 Getting Started (3-Month Roadmap)

### Month 1: Foundation
- ✅ Set up MLflow/W&B
- ✅ Start logging user interactions
- ✅ Train YOLOv8 on DeepFashion2
- ✅ Create evaluation datasets

### Month 2: Core Models
- ✅ Train XGBoost ranker with real data
- ✅ Train attribute extractor
- ✅ A/B test ranker improvements

### Month 3: Optimization
- ✅ Fine-tune CLIP on your data
- ✅ Add personalization features
- ✅ Deploy local LLM (optional)

---

## 📚 Dataset Resources

### Fashion Object Detection
- **DeepFashion2**: https://github.com/switchablenorms/DeepFashion2
  - 491k images, 13 categories, bounding boxes + keypoints
- **ModaNet**: https://github.com/eBay/modanet
  - 55k images, 13 categories
- **Fashionpedia**: https://fashionpedia.github.io/home/
  - 48k images, 27 categories, 56 attributes

### Fashion Attributes
- **DeepFashion**: http://mmlab.ie.cuhk.edu.hk/projects/DeepFashion.html
  - 800k images, category/attribute/landmark annotations

### Fashion Search/Retrieval
- **FashionIQ**: https://github.com/XiaoxiaoGuo/fashion-iq
  - Image + text query pairs for fashion search

### Outfits
- **Polyvore**: https://github.com/xthan/polyvore-dataset
  - 21k outfits with compatibility labels

---

## 📞 Next Steps

1. **Review this document** with your team
2. **Prioritize** based on business needs
3. **Assign ownership** for each model improvement
4. **Set up infrastructure** (MLflow, monitoring)
5. **Start with Priority 1** (train XGBoost ranker)

---

**Questions?** Check these docs:
- `docs/ml-models.md` - Detailed model documentation
- `docs/IMPLEMENTATION_COMPLETE.md` - Multi-vector search spec
- `docs/SEARCH_FEATURES_GUIDE.md` - Search API usage
- `MULTI_VECTOR_IMPLEMENTATION.md` - Multi-vector architecture

**Need help?** Your models are well-structured. The main gap is **training with real data**. Focus on that first! 🚀

