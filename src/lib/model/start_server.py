#!/usr/bin/env python3
"""Simple test to run the ranker API"""

import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    # Import the app
    from ranker_api import app
    print("✅ API module imported successfully")
    
    # Start server
    import uvicorn
    print("🚀 Starting recommendation ranker API server...")
    print("📍 Server will run at: http://127.0.0.1:8001")
    print("📚 API Documentation: http://127.0.0.1:8001/docs")
    print("❤️  Health Check: http://127.0.0.1:8001/health")
    print("🔮 Prediction: POST http://127.0.0.1:8001/predict")
    print("Press Ctrl+C to stop the server\n")
    
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()