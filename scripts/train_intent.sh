#!/usr/bin/env bash
# Quick training script for intent classifier

echo "🚀 Training Lebanese Fashion Intent Classifier"
echo "============================================="

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python -m venv .venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Install requirements
echo "Installing ML training dependencies..."
pip install -r scripts/requirements-intent.txt

# Create models directory
mkdir -p models

echo "📊 Dataset Info:"
echo "- Lebanese fashion queries: ~200 samples"
echo "- Multi-language: English, Arabic, Arabizi, Mixed"
echo "- 6 intent types: price_search, product_search, comparison, brand_search, outfit_completion, trending_search"

echo ""
echo "🤖 Training FastText Model (lightweight, fast)..."
python scripts/train_intent_classifier.py \
    --dataset data/intent_training_dataset_lebanese.txt \
    --model fasttext \
    --output models/intent_classifier_fasttext.bin

echo ""
echo "✅ Training completed!"
echo "📁 Model saved to: models/intent_classifier_fasttext.bin"
echo ""
echo "🧪 To test the model:"
echo "python -c \"
import fasttext
model = fasttext.load_model('models/intent_classifier_fasttext.bin')
queries = ['shoes under 50 lira', 'men sneakers lebanon', 'nike vs adidas']
for q in queries:
    pred = model.predict(q)
    print(f'{q} → {pred[0][0]} ({pred[1][0]:.3f})')
\""

echo ""
echo "🔧 Integration:"
echo "1. Update ml-intent.ts to load the trained model"
echo "2. Set ML_CONFIG.enabled = true"
echo "3. Test with low-confidence queries"
