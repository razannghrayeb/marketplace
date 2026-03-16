# Quick training script for intent classifier (Windows)

Write-Host "🚀 Training Lebanese Fashion Intent Classifier" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# Check if virtual environment exists
if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& ".venv\Scripts\Activate.ps1"

# Install requirements
Write-Host "Installing ML training dependencies..." -ForegroundColor Yellow
pip install -r scripts\requirements-intent.txt

# Create models directory
if (-not (Test-Path "models")) {
    New-Item -ItemType Directory -Path "models"
}

Write-Host "📊 Dataset Info:" -ForegroundColor Cyan
Write-Host "- Lebanese fashion queries: ~200 samples"
Write-Host "- Multi-language: English, Arabic, Arabizi, Mixed"
Write-Host "- 6 intent types: price_search, product_search, comparison, brand_search, outfit_completion, trending_search"

Write-Host ""
Write-Host "🤖 Training FastText Model (lightweight, fast)..." -ForegroundColor Yellow
python scripts\train_intent_classifier.py `
    --dataset data\intent_training_dataset_lebanese.txt `
    --model fasttext `
    --output models\intent_classifier_fasttext.bin

Write-Host ""
Write-Host "✅ Training completed!" -ForegroundColor Green
Write-Host "📁 Model saved to: models\intent_classifier_fasttext.bin"
Write-Host ""
Write-Host "🧪 To test the model:" -ForegroundColor Cyan
Write-Host @"
python -c "
import fasttext
model = fasttext.load_model('models/intent_classifier_fasttext.bin')
queries = ['shoes under 50 lira', 'men sneakers lebanon', 'nike vs adidas']
for q in queries:
    pred = model.predict(q)
    print(f'{q} → {pred[0][0]} ({pred[1][0]:.3f})')
"
"@

Write-Host ""
Write-Host "🔧 Integration:" -ForegroundColor Magenta
Write-Host "1. Update ml-intent.ts to load the trained model"
Write-Host "2. Set ML_CONFIG.enabled = true"
Write-Host "3. Test with low-confidence queries"
