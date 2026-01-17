# Machine Learning Models Guide

This guide covers the machine learning components of the Fashion Aggregator API, including model architectures, training procedures, and integration details.

## Overview

The Fashion Aggregator API incorporates several ML models to provide intelligent features:

1. **CLIP (Contrastive Language-Image Pre-training)** - For image embeddings and visual similarity
2. **XGBoost Ranker** - For ranking product recommendations
3. **Semantic Search** - For query understanding and expansion
4. **Quality Analysis** - For automated product quality assessment

---

## CLIP Model Integration

### Model Details
- **Architecture**: OpenAI CLIP ViT-B/32
- **Format**: ONNX for optimized inference
- **Input**: 224x224 RGB images
- **Output**: 512-dimensional embeddings
- **Purpose**: Visual similarity search and duplicate detection

### Installation and Setup

```bash
# Download CLIP model
pnpm run download-clip

# Verify installation
ls -la models/
# Should contain: clip-image-vit-32.onnx (approx 350MB)
```

### Usage in Code

```typescript
import { initClip, generateImageEmbedding, computeSimilarity } from './lib/image/clip';

// Initialize model (one-time)
await initClip();

// Generate embedding for uploaded image
const imageBuffer = await sharp(uploadedFile)
  .resize(224, 224)
  .rgb()
  .raw()
  .toBuffer();

const embedding = await generateImageEmbedding(imageBuffer);

// Find similar products
const similarProducts = await findSimilarByEmbedding(embedding, 0.8);
```

### Performance Optimization

#### Memory Management
```typescript
// Batch processing for multiple images
const embeddings = await Promise.all(
  imageBatches.map(batch => 
    generateImageEmbeddingBatch(batch, { batchSize: 8 })
  )
);

// Memory cleanup after processing
if (process.env.NODE_ENV === 'production') {
  global.gc?.(); // Force garbage collection
}
```

#### Caching Strategy
```typescript
// Redis cache for computed embeddings
const cacheKey = `embedding:${imageHash}`;
let embedding = await redis.get(cacheKey);

if (!embedding) {
  embedding = await generateImageEmbedding(imageBuffer);
  await redis.setex(cacheKey, 3600, JSON.stringify(embedding));
}
```

### Quality Metrics
- **Similarity threshold**: 0.7 for recommendations, 0.85 for duplicates
- **Processing time**: ~200ms per image on CPU, ~50ms on GPU
- **Memory usage**: ~1.5GB model + ~100MB per batch

---

## XGBoost Ranking Model

### Model Architecture

The XGBoost ranker uses gradient boosting to rank product recommendations based on multiple features:

#### Feature Categories
1. **Similarity Features**
   - CLIP visual similarity score
   - Text similarity score
   - Category compatibility
   - Brand affinity

2. **Style Features**
   - Style matching score (casual, formal, sporty)
   - Color harmony score
   - Seasonality compatibility
   - Occasion appropriateness

3. **Market Features**
   - Price ratio (target vs candidate)
   - Quality score differential
   - Popularity metrics
   - Vendor reliability

4. **Context Features**
   - User interaction history
   - Time of day/season
   - Geographic preferences
   - Device type

### Training Pipeline

#### 1. Data Collection
```python
# training_data_collector.py
import pandas as pd
from sqlalchemy import create_engine

def collect_training_data(days_back=30):
    """Collect labeled interaction data for training"""
    engine = create_engine(DATABASE_URL)
    
    query = """
    SELECT 
        ri.source_product_id,
        ri.candidate_product_id,
        ri.position,
        ri.clicked,
        ri.purchased,
        rl.label,
        -- Feature columns
        rf.style_score,
        rf.color_score,
        rf.clip_sim,
        rf.text_sim,
        rf.price_ratio,
        p1.category as source_category,
        p2.category as candidate_category
    FROM recommendation_impressions ri
    LEFT JOIN recommendation_labels rl ON ri.id = rl.impression_id
    LEFT JOIN recommendation_features rf ON ri.id = rf.impression_id
    LEFT JOIN products p1 ON ri.source_product_id = p1.id
    LEFT JOIN products p2 ON ri.candidate_product_id = p2.id
    WHERE ri.created_at >= NOW() - INTERVAL '%s days'
    AND rl.label IS NOT NULL
    """ % days_back
    
    return pd.read_sql(query, engine)
```

#### 2. Feature Engineering
```python
# feature_engineering.py
def engineer_features(df):
    """Create engineered features for training"""
    
    # Interaction features
    df['price_ratio_log'] = np.log1p(df['price_ratio'])
    df['similarity_product'] = df['clip_sim'] * df['text_sim']
    df['style_color_harmony'] = df['style_score'] * df['color_score']
    
    # Category encoding
    category_pairs = df['source_category'] + '_to_' + df['candidate_category']
    df = pd.concat([df, pd.get_dummies(category_pairs, prefix='cat_pair')], axis=1)
    
    # Positional features
    df['position_log'] = np.log1p(df['position'])
    df['position_inverse'] = 1.0 / (df['position'] + 1)
    
    return df
```

#### 3. Model Training
```python
# train_xgb_ranker.py
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import ndcg_score

def train_ranker(df):
    """Train XGBoost ranking model"""
    
    # Prepare features and labels
    feature_cols = [col for col in df.columns if col.startswith(('style_', 'color_', 'clip_', 'text_', 'price_', 'cat_'))]
    X = df[feature_cols]
    y = df['label'].map({'good': 1.0, 'ok': 0.5, 'bad': 0.0})
    
    # Group by query (source product)
    groups = df.groupby('source_product_id').size().values
    
    # Train-test split maintaining groups
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Train XGBoost ranker
    model = xgb.XGBRanker(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42
    )
    
    model.fit(
        X_train, y_train,
        group=groups[:len(X_train)],
        eval_set=[(X_test, y_test)],
        eval_group=[groups[len(X_train):]],
        eval_metric='ndcg@10',
        early_stopping_rounds=20,
        verbose=True
    )
    
    return model, feature_cols

# Save model and metadata
model, features = train_ranker(training_data)
model.save_model('models/xgb_ranker_model.json')

metadata = {
    'version': '2.1',
    'features': features,
    'training_date': datetime.now().isoformat(),
    'training_samples': len(training_data),
    'ndcg_score': float(ndcg_score),
}

with open('models/ranker_model_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)
```

### Model Serving

#### FastAPI Service
```python
# ranker_api.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import xgboost as xgb
import pandas as pd
import numpy as np

app = FastAPI(title="Fashion Ranker API")

# Global model instance
model = None
feature_names = None

class PredictionRequest(BaseModel):
    features: List[Dict[str, float]]
    
class PredictionResponse(BaseModel):
    scores: List[float]
    model_version: str

@app.on_event("startup")
async def load_model():
    global model, feature_names
    
    model = xgb.XGBRanker()
    model.load_model('models/xgb_ranker_model.json')
    
    with open('models/ranker_model_metadata.json') as f:
        metadata = json.load(f)
        feature_names = metadata['features']

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    try:
        # Convert to DataFrame with proper feature order
        df = pd.DataFrame(request.features)[feature_names]
        
        # Handle missing features
        df = df.fillna(0.0)
        
        # Predict scores
        scores = model.predict(df).tolist()
        
        return PredictionResponse(
            scores=scores,
            model_version="v2.1"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model_loaded": model is not None}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### Node.js Integration
```typescript
// ranker/client.ts
interface RankerPrediction {
  scores: number[];
  model_version: string;
}

export async function predictWithFallback(
  features: FeatureRow[],
  options: RankingOptions = {}
): Promise<number[]> {
  try {
    // Try ML service first
    if (await isRankerAvailable()) {
      const response = await fetch(`${RANKER_SERVICE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
        timeout: options.timeout || 5000,
      });
      
      const prediction: RankerPrediction = await response.json();
      return prediction.scores;
    }
  } catch (error) {
    logger.warn('Ranker service unavailable, using heuristic fallback', error);
  }
  
  // Fallback to heuristic scoring
  return features.map(feature => computeHeuristicScore(feature));
}

function computeHeuristicScore(feature: FeatureRow): number {
  // Simple weighted combination as fallback
  const weights = {
    clip_sim: 0.3,
    text_sim: 0.2,
    style_score: 0.25,
    color_score: 0.15,
    price_ratio: 0.1,
  };
  
  return Object.entries(weights).reduce((score, [key, weight]) => {
    return score + (feature[key] || 0) * weight;
  }, 0);
}
```

### Model Performance

#### Evaluation Metrics
- **NDCG@10**: 0.78 (normalized discounted cumulative gain)
- **MAP**: 0.72 (mean average precision)
- **CTR Improvement**: +15% vs baseline
- **Conversion Improvement**: +8% vs baseline

#### A/B Testing Framework
```typescript
// experiments/ab_testing.ts
export class RankerABTest {
  constructor(
    private controlModel: string,
    private treatmentModel: string,
    private trafficSplit: number = 0.1
  ) {}
  
  async getRecommendations(
    userId: string,
    productId: number,
    candidates: CandidateResult[]
  ): Promise<RankedResult[]> {
    const isInTreatment = this.shouldUseTreatment(userId);
    const modelVersion = isInTreatment ? this.treatmentModel : this.controlModel;
    
    const results = await this.rankWithModel(candidates, modelVersion);
    
    // Log assignment for analysis
    await this.logExperimentAssignment(userId, modelVersion, {
      productId,
      candidateCount: candidates.length,
    });
    
    return results;
  }
  
  private shouldUseTreatment(userId: string): boolean {
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    const hashInt = parseInt(hash.substring(0, 8), 16);
    return (hashInt % 100) < (this.trafficSplit * 100);
  }
}
```

---

## Semantic Search Engine

### Query Understanding Pipeline

#### 1. Intent Classification
```typescript
// search/semanticSearch.ts
export function classifyQueryIntent(query: string): QueryIntent {
  const normalizedQuery = query.toLowerCase();
  
  // Price-focused queries
  if (/\b(cheap|expensive|price|under|over|\$|€|£)\b/.test(normalizedQuery)) {
    return 'price_search';
  }
  
  // Brand-focused queries
  if (KNOWN_BRANDS.has(extractBrand(normalizedQuery))) {
    return 'brand_search';
  }
  
  // Category browsing
  if (KNOWN_CATEGORIES.has(extractCategory(normalizedQuery))) {
    return 'category_browse';
  }
  
  // Style searches
  if (/\b(style|aesthetic|vibe|look|outfit)\b/.test(normalizedQuery)) {
    return 'style_search';
  }
  
  // Comparison intent
  if (/\b(vs|versus|compare|better|best)\b/.test(normalizedQuery)) {
    return 'comparison';
  }
  
  return 'product_search';
}
```

#### 2. Entity Extraction
```typescript
export function extractEntities(query: string): QueryEntities {
  const entities: QueryEntities = {
    brands: [],
    categories: [],
    colors: [],
    sizes: [],
    attributes: [],
  };
  
  // Brand extraction
  entities.brands = extractBrands(query);
  
  // Color extraction with synonyms
  entities.colors = extractColors(query);
  
  // Size extraction (US, EU, UK sizes)
  entities.sizes = extractSizes(query);
  
  // Category detection
  entities.categories = extractCategories(query);
  
  // Price range extraction
  entities.priceRange = extractPriceRange(query);
  
  return entities;
}

function extractColors(query: string): string[] {
  const colorMap = {
    'red': ['red', 'crimson', 'scarlet', 'burgundy', 'maroon'],
    'blue': ['blue', 'navy', 'royal blue', 'sky blue', 'turquoise'],
    'black': ['black', 'ebony', 'jet black'],
    'white': ['white', 'ivory', 'cream', 'off-white'],
    'green': ['green', 'olive', 'forest green', 'mint'],
    // ... more color mappings
  };
  
  const found = new Set<string>();
  
  for (const [canonical, variants] of Object.entries(colorMap)) {
    for (const variant of variants) {
      if (query.toLowerCase().includes(variant)) {
        found.add(canonical);
        break;
      }
    }
  }
  
  return Array.from(found);
}
```

#### 3. Query Expansion
```typescript
export function expandQuery(entities: QueryEntities, originalQuery: string): string[] {
  const expandedTerms = [originalQuery];
  
  // Add synonyms for detected entities
  entities.brands.forEach(brand => {
    expandedTerms.push(...getBrandSynonyms(brand));
  });
  
  entities.categories.forEach(category => {
    expandedTerms.push(...getCategorySynonyms(category));
  });
  
  entities.colors.forEach(color => {
    expandedTerms.push(...getColorSynonyms(color));
  });
  
  // Add related terms based on query intent
  const intent = classifyQueryIntent(originalQuery);
  expandedTerms.push(...getIntentBasedTerms(intent));
  
  return [...new Set(expandedTerms)]; // Deduplicate
}
```

### Hybrid Search Implementation

```typescript
// search/hybridSearch.ts
export async function hybridSearch(
  query: string,
  filters: SearchFilters,
  options: SearchOptions
): Promise<SearchResult[]> {
  const parsedQuery = parseQuery(query);
  
  // Parallel searches
  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(parsedQuery, filters),
    semanticVectorSearch(parsedQuery, filters)
  ]);
  
  // Merge and rerank results
  const mergedResults = mergeSearchResults(
    keywordResults,
    semanticResults,
    {
      keywordWeight: 0.6,
      semanticWeight: 0.4,
    }
  );
  
  // Apply business rules
  const rankedResults = applyBusinessRules(mergedResults, parsedQuery);
  
  return rankedResults.slice(0, options.limit || 20);
}

function mergeSearchResults(
  keywordResults: SearchResult[],
  semanticResults: SearchResult[],
  weights: { keywordWeight: number; semanticWeight: number }
): SearchResult[] {
  const resultMap = new Map<number, SearchResult>();
  
  // Add keyword results
  keywordResults.forEach(result => {
    resultMap.set(result.id, {
      ...result,
      combinedScore: result.score * weights.keywordWeight,
      sources: ['keyword']
    });
  });
  
  // Merge semantic results
  semanticResults.forEach(result => {
    if (resultMap.has(result.id)) {
      const existing = resultMap.get(result.id)!;
      existing.combinedScore += result.score * weights.semanticWeight;
      existing.sources.push('semantic');
    } else {
      resultMap.set(result.id, {
        ...result,
        combinedScore: result.score * weights.semanticWeight,
        sources: ['semantic']
      });
    }
  });
  
  return Array.from(resultMap.values())
    .sort((a, b) => b.combinedScore - a.combinedScore);
}
```

---

## Quality Analysis Engine

### Text Quality Assessment

#### Feature Extraction
```typescript
// compare/textQualityAnalyzer.ts
export function analyzeTextQuality(product: ProductForAnalysis): QualityAnalysis {
  const description = product.description || '';
  const title = product.title || '';
  
  return {
    word_count: countWords(description),
    readability_score: calculateReadabilityScore(description),
    completeness_score: assessCompleteness(description),
    attribute_coverage: analyzeAttributeCoverage(description),
    red_flags: detectRedFlags(description),
    quality_indicators: detectQualityIndicators(description),
  };
}

function assessCompleteness(description: string): number {
  const indicators = {
    fabric_info: /\b(cotton|polyester|wool|silk|denim|leather)\b/i,
    care_instructions: /\b(wash|dry clean|iron|bleach)\b/i,
    fit_info: /\b(slim|regular|loose|tight|oversized)\b/i,
    size_guide: /\b(size|fit|measurements|dimensions)\b/i,
    features: /\b(pocket|zipper|button|collar|sleeve)\b/i,
  };
  
  let score = 0;
  const totalIndicators = Object.keys(indicators).length;
  
  for (const [key, pattern] of Object.entries(indicators)) {
    if (pattern.test(description)) {
      score += 1;
    }
  }
  
  return (score / totalIndicators) * 100;
}

function detectRedFlags(description: string): string[] {
  const redFlags: string[] = [];
  
  // Quality concerns
  if (/\b(knock[- ]?off|replica|fake|imitation)\b/i.test(description)) {
    redFlags.push('authenticity_concern');
  }
  
  // Vague descriptions
  if (description.length < 50) {
    redFlags.push('too_short');
  }
  
  // Excessive marketing language
  if (/\b(amazing|incredible|unbelievable|revolutionary)\b/gi.test(description).length > 3) {
    redFlags.push('excessive_marketing');
  }
  
  // Poor grammar/spelling indicators
  if (/\b(alot|recieve|definately|seperate)\b/i.test(description)) {
    redFlags.push('spelling_errors');
  }
  
  return redFlags;
}
```

### Price Analysis Engine

```typescript
// compare/priceAnomalyDetector.ts
export async function analyzePriceAnomalies(
  product: ProductForAnalysis
): Promise<PriceAnalysis> {
  const category = product.category || 'unknown';
  const priceUSD = convertToUSD(product.price_cents, product.currency);
  
  // Get category baseline
  const baseline = await getCategoryBaseline(category);
  
  if (!baseline) {
    return createDefaultPriceAnalysis(priceUSD);
  }
  
  const marketPosition = determineMarketPosition(priceUSD, baseline);
  const volatility = await calculatePriceVolatility(product.id);
  
  return {
    current_price_usd: priceUSD,
    market_position: marketPosition,
    market_ratio: priceUSD / baseline.median_price_usd,
    volatility_30d: volatility.thirtyDay,
    volatility_level: classifyVolatility(volatility.thirtyDay),
    anomalies: detectAnomalies(priceUSD, baseline, volatility),
    price_score: calculatePriceScore(marketPosition, volatility),
  };
}

function determineMarketPosition(
  price: number,
  baseline: CategoryBaseline
): MarketPosition {
  const ratio = price / baseline.median_price_usd;
  
  if (ratio < 0.3) return 'suspicious_low';
  if (ratio < 0.5) return 'too_low';
  if (ratio < 0.8) return 'below_market';
  if (ratio <= 1.2) return 'normal';
  if (ratio <= 1.8) return 'above_market';
  return 'too_high';
}

async function calculatePriceVolatility(productId: number): Promise<{
  thirtyDay: number;
  ninetyDay: number;
}> {
  const priceHistory = await getPriceHistory(productId, 90);
  
  if (priceHistory.length < 3) {
    return { thirtyDay: 0, ninetyDay: 0 };
  }
  
  const prices30d = priceHistory.slice(-30).map(p => p.price_cents);
  const prices90d = priceHistory.map(p => p.price_cents);
  
  return {
    thirtyDay: calculateStandardDeviation(prices30d) / mean(prices30d),
    ninetyDay: calculateStandardDeviation(prices90d) / mean(prices90d),
  };
}
```

---

## Model Monitoring and Maintenance

### Performance Monitoring

#### Metrics Collection
```typescript
// monitoring/mlMetrics.ts
export class MLMetricsCollector {
  private metrics = {
    clip_embedding_time: new Histogram('clip_embedding_duration_seconds'),
    ranker_prediction_time: new Histogram('ranker_prediction_duration_seconds'),
    search_relevance_score: new Histogram('search_relevance_score'),
    recommendation_ctr: new Counter('recommendation_clicks_total'),
    model_fallback_count: new Counter('ml_service_fallbacks_total'),
  };
  
  recordEmbeddingTime(duration: number): void {
    this.metrics.clip_embedding_time.observe(duration / 1000);
  }
  
  recordRankerTime(duration: number): void {
    this.metrics.ranker_prediction_time.observe(duration / 1000);
  }
  
  recordRecommendationClick(clicked: boolean): void {
    if (clicked) {
      this.metrics.recommendation_ctr.inc();
    }
  }
  
  recordModelFallback(service: string): void {
    this.metrics.model_fallback_count.inc({ service });
  }
}
```

### Automated Retraining

#### Training Pipeline
```python
# ml/training_pipeline.py
class AutoTrainingPipeline:
    def __init__(self, config):
        self.config = config
        self.db = DatabaseConnection(config.database_url)
        
    def should_retrain(self) -> bool:
        """Determine if model needs retraining"""
        
        # Check data freshness
        latest_data = self.db.get_latest_training_data_date()
        days_since_training = (datetime.now() - latest_data).days
        
        if days_since_training > self.config.max_days_without_retraining:
            return True
            
        # Check performance degradation
        current_metrics = self.get_current_model_metrics()
        if current_metrics.ndcg_score < self.config.min_performance_threshold:
            return True
            
        # Check data volume
        new_samples = self.db.count_unlabeled_samples()
        if new_samples > self.config.min_samples_for_retraining:
            return True
            
        return False
        
    def run_training_pipeline(self):
        """Execute full training pipeline"""
        logger.info("Starting automated training pipeline")
        
        # Collect and validate data
        training_data = self.collect_training_data()
        validation_data = self.collect_validation_data()
        
        # Train new model
        new_model = self.train_xgboost_ranker(training_data)
        
        # Validate performance
        metrics = self.evaluate_model(new_model, validation_data)
        
        if metrics.ndcg_score > self.config.min_deployment_threshold:
            # Deploy new model
            self.deploy_model(new_model, metrics)
            logger.info(f"New model deployed with NDCG: {metrics.ndcg_score}")
        else:
            logger.warning(f"New model performance too low: {metrics.ndcg_score}")
```

### Model Versioning

```typescript
// ml/modelVersioning.ts
export class ModelVersionManager {
  async deployNewVersion(
    modelPath: string,
    metadata: ModelMetadata
  ): Promise<void> {
    // Validate model
    await this.validateModel(modelPath);
    
    // Create versioned deployment
    const version = await this.createVersion(metadata);
    
    // Gradual rollout
    await this.gradualRollout(version, {
      initialTraffic: 0.05,
      maxTraffic: 1.0,
      rolloutDuration: '1h',
    });
  }
  
  async rollbackToVersion(version: string): Promise<void> {
    logger.warn(`Rolling back to model version ${version}`);
    
    // Switch traffic to stable version
    await this.switchModelVersion(version);
    
    // Alert monitoring systems
    await this.sendRollbackAlert(version);
  }
  
  private async gradualRollout(
    version: string,
    config: RolloutConfig
  ): Promise<void> {
    let currentTraffic = config.initialTraffic;
    const increment = 0.1;
    const intervalMs = 10 * 60 * 1000; // 10 minutes
    
    while (currentTraffic < config.maxTraffic) {
      await this.setTrafficPercentage(version, currentTraffic);
      
      // Monitor performance for interval
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      
      const metrics = await this.getVersionMetrics(version);
      if (metrics.errorRate > 0.01) {
        throw new Error(`High error rate detected: ${metrics.errorRate}`);
      }
      
      currentTraffic = Math.min(currentTraffic + increment, config.maxTraffic);
    }
  }
}
```

This ML guide provides comprehensive coverage of all machine learning components in the Fashion Aggregator API. Each section includes practical implementation details, performance considerations, and maintenance procedures.