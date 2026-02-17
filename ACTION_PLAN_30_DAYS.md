# 🎯 Immediate Action Plan - Next 30 Days

This is your tactical implementation plan for the next month.

---

## Week 1: Assessment & Infrastructure

### Day 1-2: Data Assessment
- [ ] **Check training data availability**
  ```sql
  SELECT COUNT(*) FROM recommendation_impressions;
  SELECT COUNT(*) FROM recommendation_labels;
  -- Need at least 10k samples for ranker training
  ```
- [ ] **Verify model files exist**
  ```powershell
  Test-Path models/xgb_ranker_model.json
  Test-Path models/yolov8-fashion.pt
  Test-Path models/fashion-clip-image.onnx
  ```
- [ ] **Test all model endpoints**
  - CLIP embedding generation
  - YOLOv8 detection (if working)
  - Ranker prediction
  - Multi-vector search

### Day 3-5: Set Up Infrastructure
- [ ] **Install MLflow for experiment tracking**
  ```bash
  pip install mlflow
  mlflow server --backend-store-uri sqlite:///mlflow.db --default-artifact-root ./mlruns
  ```
- [ ] **Add model performance logging**
  - Log inference latency
  - Log error rates
  - Track cache hit rates
- [ ] **Create evaluation dataset**
  - 100 manually labeled query-product pairs
  - Format: `{ query, product_id, relevance_score: 0-3 }`
  - Save as `data/eval_queries.json`

---

## Week 2: Fix Critical Issues

### Priority 1: XGBoost Ranker
**Goal**: Replace dummy model with trained model

**Steps**:
1. **Export training data** (Day 6)
   ```python
   # scripts/export_ranker_training_data.py
   import pandas as pd
   from sqlalchemy import create_engine
   
   engine = create_engine(DATABASE_URL)
   
   query = """
   SELECT 
     ri.source_product_id,
     ri.candidate_product_id,
     ri.position,
     ri.clicked::int as clicked,
     ri.purchased::int as purchased,
     -- Features from candidate generation
     cs.clip_sim,
     cs.text_sim,
     cs.style_score,
     cs.color_score,
     cs.price_ratio,
     cs.same_brand::int
   FROM recommendation_impressions ri
   JOIN candidate_scores cs ON ...
   WHERE ri.created_at > NOW() - INTERVAL '90 days'
   """
   
   df = pd.read_sql(query, engine)
   
   # Create labels: purchase=2, click=1, no_action=0
   df['label'] = df['purchased'] * 2 + df['clicked']
   
   # Train/val/test split
   from sklearn.model_selection import train_test_split
   train, temp = train_test_split(df, test_size=0.3, random_state=42)
   val, test = train_test_split(temp, test_size=0.5, random_state=42)
   
   train.to_csv('data/ranker_train.csv', index=False)
   val.to_csv('data/ranker_val.csv', index=False)
   test.to_csv('data/ranker_test.csv', index=False)
   ```

2. **Train XGBoost model** (Day 7-8)
   ```python
   # scripts/train_xgboost_ranker.py
   import xgboost as xgb
   import pandas as pd
   from sklearn.metrics import ndcg_score
   
   # Load data
   train = pd.read_csv('data/ranker_train.csv')
   val = pd.read_csv('data/ranker_val.csv')
   
   # Features
   features = [
     'clip_sim', 'text_sim', 'style_score', 'color_score',
     'price_ratio', 'same_brand', 'position'
   ]
   
   X_train = train[features]
   y_train = train['label']
   X_val = val[features]
   y_val = val['label']
   
   # Create group info (for ranking)
   train_groups = train.groupby('source_product_id').size().values
   val_groups = val.groupby('source_product_id').size().values
   
   # Train
   dtrain = xgb.DMatrix(X_train, label=y_train)
   dval = xgb.DMatrix(X_val, label=y_val)
   
   dtrain.set_group(train_groups)
   dval.set_group(val_groups)
   
   params = {
     'objective': 'rank:ndcg',
     'learning_rate': 0.1,
     'max_depth': 6,
     'min_child_weight': 1,
     'subsample': 0.8,
     'colsample_bytree': 0.8,
     'eval_metric': 'ndcg@10',
   }
   
   model = xgb.train(
     params,
     dtrain,
     num_boost_round=100,
     evals=[(dtrain, 'train'), (dval, 'val')],
     early_stopping_rounds=10
   )
   
   # Save
   model.save_model('models/xgb_ranker_model_trained.json')
   
   # Evaluate
   y_pred = model.predict(dval)
   print(f"Validation NDCG@10: {ndcg_score([y_val], [y_pred], k=10)}")
   ```

3. **Deploy new model** (Day 9)
   - Backup old model: `mv models/xgb_ranker_model.json models/xgb_ranker_model_dummy_backup.json`
   - Deploy new: `mv models/xgb_ranker_model_trained.json models/xgb_ranker_model.json`
   - Update metadata
   - Restart service
   - Monitor for errors

### Priority 2: YOLOv8 Model
**Goal**: Ensure working object detection

**Option A: Quick Fix** (if model is missing) - Day 10
```python
# Download pre-trained YOLOv8
from ultralytics import YOLO

model = YOLO('yolov8m.pt')  # Medium variant
model.save('models/yolov8-fashion.pt')
print("YOLOv8 model downloaded")
```

**Option B: Proper Training** (start in Week 3)
- Download DeepFashion2 dataset (large, ~40GB)
- Set up training pipeline
- Train for 100 epochs (~2-3 days on GPU)

---

## Week 3: Model Monitoring & Optimization

### Day 11-12: Add Monitoring
**Goal**: Track model performance in production

**Implementation**:
```typescript
// src/lib/monitoring/modelMetrics.ts
import { performance } from 'perf_hooks';

interface ModelMetric {
  model: string;
  operation: string;
  latency_ms: number;
  status: 'success' | 'error';
  timestamp: Date;
}

const metrics: ModelMetric[] = [];

export function trackModelCall<T>(
  modelName: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  
  return fn()
    .then((result) => {
      metrics.push({
        model: modelName,
        operation,
        latency_ms: performance.now() - start,
        status: 'success',
        timestamp: new Date()
      });
      return result;
    })
    .catch((error) => {
      metrics.push({
        model: modelName,
        operation,
        latency_ms: performance.now() - start,
        status: 'error',
        timestamp: new Date()
      });
      throw error;
    });
}

export function getMetricsSummary() {
  const summary = {};
  for (const metric of metrics) {
    const key = `${metric.model}_${metric.operation}`;
    if (!summary[key]) {
      summary[key] = {
        count: 0,
        total_latency: 0,
        errors: 0
      };
    }
    summary[key].count++;
    summary[key].total_latency += metric.latency_ms;
    if (metric.status === 'error') summary[key].errors++;
  }
  
  return Object.entries(summary).map(([key, data]) => ({
    model_operation: key,
    avg_latency_ms: data.total_latency / data.count,
    error_rate: data.errors / data.count,
    call_count: data.count
  }));
}
```

**Usage**:
```typescript
// Wrap model calls
const embedding = await trackModelCall(
  'CLIP',
  'generateImageEmbedding',
  () => generateImageEmbedding(imageBuffer)
);
```

**Add metrics endpoint**:
```typescript
// routes/admin/metrics.routes.ts
router.get('/metrics/models', async (req, res) => {
  const summary = getMetricsSummary();
  res.json({ metrics: summary });
});
```

### Day 13-14: Optimize CLIP Performance
- [ ] **Benchmark current performance**
  ```typescript
  // scripts/benchmark-clip.ts
  const images = loadTestImages(100);
  const start = Date.now();
  
  for (const img of images) {
    await generateImageEmbedding(img);
  }
  
  const totalTime = Date.now() - start;
  console.log(`Avg time per image: ${totalTime / images.length}ms`);
  ```
- [ ] **Enable batch processing** (if not already)
- [ ] **Verify GPU is being used** (if available)
- [ ] **Check cache hit rate**
  ```typescript
  const cacheStats = await redis.info('stats');
  console.log(`Cache hit rate: ${cacheStats.keyspace_hits / (cacheStats.keyspace_hits + cacheStats.keyspace_misses)}`);
  ```

---

## Week 4: Start Attribute Extractor

### Day 15-18: Prepare Dataset
**Goal**: Get data ready for attribute extraction training

**Steps**:
1. **Download DeepFashion2** (~40GB)
   ```bash
   # Register at https://github.com/switchablenorms/DeepFashion2
   # Download train/validation/test sets
   wget [provided_link] -O deepfashion2.zip
   unzip deepfashion2.zip -d data/DeepFashion2/
   ```

2. **Extract attribute labels**
   ```python
   # scripts/prepare_attribute_dataset.py
   import json
   import pandas as pd
   
   # DeepFashion2 annotations
   with open('data/DeepFashion2/train/annos.json') as f:
     annos = json.load(f)
   
   # Extract attribute labels
   data = []
   for img_name, anno in annos.items():
     for item in anno:
       data.append({
         'image_path': f"data/DeepFashion2/train/image/{img_name}",
         'bbox': item['bounding_box'],
         'category': item['category_id'],
         'style': item.get('style', 0),
         # Add other attributes
       })
   
   df = pd.DataFrame(data)
   df.to_csv('data/attribute_training_data.csv', index=False)
   ```

3. **Create training script skeleton**
   ```python
   # scripts/train_attribute_extractor.py
   # (Use code from src/lib/model/inference.py as template)
   ```

### Day 19-21: Begin Training
- [ ] Set up training environment (GPU, PyTorch)
- [ ] Run first training epoch
- [ ] Monitor loss curves
- [ ] Save checkpoints

---

## Success Criteria (End of Month)

✅ **Must Have**:
- [ ] XGBoost ranker trained on real data and deployed
- [ ] Model monitoring in place (latency, errors)
- [ ] Evaluation dataset created
- [ ] YOLOv8 working (even if not fine-tuned)

🎯 **Nice to Have**:
- [ ] Attribute extractor training started
- [ ] CLIP performance optimized (< 50ms per image)
- [ ] A/B test framework set up
- [ ] MLflow tracking working

📊 **Metrics to Track**:
- Ranker NDCG@10 > 0.6 (vs dummy model)
- CLIP latency p95 < 100ms
- YOLOv8 detection success rate > 90%
- Model error rate < 1%

---

## Daily Standup Questions

Ask yourself every morning:
1. Which model am I improving today?
2. What data do I need?
3. What's blocking me?
4. Can I ship something today?

---

## When You Get Stuck

### Problem: Not enough training data
**Solution**: 
- Lower the bar (5k samples may be enough)
- Use data augmentation
- Try semi-supervised learning
- Ask users for explicit feedback

### Problem: Model training is too slow
**Solution**:
- Use smaller model variant
- Reduce training epochs
- Use cloud GPU (Colab, RunPod, Lambda Labs)
- Start with subset of data

### Problem: Model accuracy is low
**Solution**:
- Check data quality (labels correct?)
- Try different hyperparameters
- Use pre-trained weights
- Increase model capacity
- Get more training data

### Problem: Don't know how to evaluate
**Solution**:
- Start simple (accuracy, precision, recall)
- Manual spot checks (look at predictions)
- A/B test against old model
- Ask users directly

---

## Resources You'll Need

### Software
- Python 3.10+ with PyTorch
- Node.js 18+ with TypeScript
- PostgreSQL + Redis + OpenSearch (already have)
- MLflow (for experiment tracking)
- XGBoost, scikit-learn

### Hardware
- **Minimum**: CPU training (slow but works)
- **Recommended**: NVIDIA GPU with 8GB+ VRAM
- **Ideal**: Cloud GPU (RTX 3090 / A100)

### Datasets
- DeepFashion2: Register at GitHub repo
- ModaNet: Available on GitHub
- Your own data: Export from database

### APIs
- Gemini API (already using) - watch costs
- Consider local LLM later (LLaMA, Mistral)

---

## End of Month Review

Schedule a 1-hour meeting to:
1. Review what was accomplished
2. Check success metrics
3. Plan next month priorities
4. Adjust roadmap based on learnings

**Key Questions**:
- Is the ranker performing better? (A/B test results)
- Are models stable in production? (error rates, latency)
- What was harder than expected?
- What should we prioritize next?

---

## Next Month Preview

**Month 2 Goals**:
- Complete attribute extractor training
- Fine-tune CLIP on your data
- Add personalization features
- Set up automated model retraining

---

**Start Date**: _______________
**Owner**: _______________
**Status**: Not Started

**Track progress**: Update checkboxes daily, add notes in comments.

Good luck! 🚀

