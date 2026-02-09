#!/usr/bin/env python3
"""Test the ranker API"""

import json
import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from ranker_api import app
    print("✅ API module imported successfully")
    
    # Test a prediction
    import requests
    import uvicorn
    from threading import Thread
    import time
    
    # Start server in background thread
    def start_server():
        uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info")
    
    server_thread = Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Wait for server to start
    time.sleep(2)
    
    # Test health endpoint
    try:
        response = requests.get("http://127.0.0.1:8001/health")
        print(f"Health check: {response.status_code} - {response.json()}")
    except Exception as e:
        print(f"Health check failed: {e}")
    
    # Test prediction
    sample_features = {
        "style_score": 0.8,
        "color_score": 0.7,
        "clip_sim": 0.85,
        "text_sim": 0.75,
        "open_search_score": 0.9,
        "price_ratio": 1.2,
        "category_pair": "dress_casual"
    }
    
    try:
        response = requests.post("http://127.0.0.1:8001/predict", json=sample_features)
        print(f"Prediction: {response.status_code} - {response.json()}")
    except Exception as e:
        print(f"Prediction failed: {e}")
    
    print("✅ Server started successfully on http://127.0.0.1:8001")
    print("Press Ctrl+C to stop the server")
    
    # Keep running
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Server stopped")
        
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()