#!/usr/bin/env python3
"""
Quick test script to verify ML model integration
"""

import sys
import os
sys.path.append('scripts')
from train_intent_simplified import IntentClassifierTrainer

def test_model():
    """Test the trained Random Forest model"""
    model_path = "models/intent_classifier_rf.pkl"
    dataset_path = "data/intent_training_dataset_lebanese.txt"

    if not os.path.exists(model_path):
        print(f"ERROR: Model not found at {model_path}")
        return False

    try:
        # Load model
        trainer = IntentClassifierTrainer(dataset_path)
        trainer.load_model(model_path)

        # Test queries
        test_queries = [
            "shoes under 50 lira",
            "nike vs adidas",
            "shi 7ilo",
            "أحذية رجالي"
        ]

        print("🧪 Testing Random Forest model:")
        print("-" * 40)

        for query in test_queries:
            intent, confidence = trainer.predict(query)
            print(f"'{query}' → {intent} ({confidence:.3f})")

        print("\n✅ Model test successful!")
        return True

    except Exception as e:
        print(f"ERROR: {e}")
        return False

if __name__ == "__main__":
    test_model()
