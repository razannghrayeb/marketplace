#!/usr/bin/env python3
"""Test the running ranker API"""

import requests
import json

# Test health endpoint
print("🔍 Testing Health Check...")
try:
    response = requests.get("http://127.0.0.1:8001/health")
    print(f"✅ Health: {response.status_code} - {response.json()}")
except Exception as e:
    print(f"❌ Health check failed: {e}")

# Test features endpoint
print("\n🔍 Testing Features Endpoint...")
try:
    response = requests.get("http://127.0.0.1:8001/features")
    features = response.json()
    print(f"✅ Features: {len(features)} expected features")
    for i, feature in enumerate(features[:5]):  # Show first 5
        print(f"   {i+1}. {feature}")
    if len(features) > 5:
        print(f"   ... and {len(features) - 5} more")
except Exception as e:
    print(f"❌ Features check failed: {e}")

# Test prediction with sample data
print("\n🔍 Testing Prediction...")
sample_features = {
    "style_score": 0.85,
    "color_score": 0.72,
    "clip_sim": 0.91,
    "text_sim": 0.68,
    "open_search_score": 0.89,
    "price_ratio": 1.15,
    "category_pair": "dress_casual"
}

try:
    response = requests.post(
        "http://127.0.0.1:8001/predict", 
        json=sample_features,
        headers={"Content-Type": "application/json"}
    )
    result = response.json()
    print(f"✅ Prediction: {response.status_code}")
    print(f"   Input: style={sample_features['style_score']}, clip_sim={sample_features['clip_sim']}")
    print(f"   Output: score={result.get('score', 'N/A'):.4f}, rank={result.get('rank', 'N/A')}")
except Exception as e:
    print(f"❌ Prediction failed: {e}")

print("\n🎉 All tests completed!")
print("🌐 API Documentation available at: http://127.0.0.1:8001/docs")