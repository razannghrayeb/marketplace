#!/usr/bin/env python3
"""
Model Evaluation and Comparison
Compare different intent classification models and analyze their performance.
"""

import os
import sys
import pickle
import pandas as pd

# Add the script directory to path for imports
sys.path.append(os.path.dirname(__file__))
from train_intent_simplified import IntentClassifierTrainer

def evaluate_model(model_path: str, dataset_path: str):
    """Evaluate a trained model on the test dataset"""
    print(f"\n🔍 Evaluating model: {model_path}")
    print("=" * 50)

    # Load model
    trainer = IntentClassifierTrainer(dataset_path)
    try:
        trainer.load_model(model_path)
    except FileNotFoundError:
        print(f"❌ Model not found: {model_path}")
        return None

    # Test queries with expected intents
    test_cases = [
        # Price search
        ("shoes under 50 lira", "price_search"),
        ("bags less than 100 dollars", "price_search"),
        ("cheap dresses", "price_search"),
        ("budget friendly shoes", "price_search"),
        ("أحذية بـ 50 ليرة", "price_search"),
        ("tiyab za8ira", "price_search"),  # cheap clothes in Arabizi

        # Product search
        ("men sneakers lebanon", "product_search"),
        ("women dresses", "product_search"),
        ("kids clothes", "product_search"),
        ("أحذية رجالي بيروت", "product_search"),
        ("fsat nisai", "product_search"),  # women's dresses in Arabizi

        # Comparison
        ("nike vs adidas", "comparison"),
        ("zara vs mango", "comparison"),
        ("compare iphone samsung", "comparison"),
        ("مقارنة هواتف", "comparison"),
        ("nike wala adidas a7san", "comparison"),

        # Brand search
        ("zara", "brand_search"),
        ("nike store beirut", "brand_search"),
        ("adidas lebanon", "brand_search"),
        ("زارا لبنان", "brand_search"),

        # Outfit completion
        ("wedding dress outfit", "outfit_completion"),
        ("graduation ceremony outfit", "outfit_completion"),
        ("ملابس العرس", "outfit_completion"),
        ("tiyab 3ars", "outfit_completion"),

        # Trending search
        ("trending bags 2024", "trending_search"),
        ("popular shoes", "trending_search"),
        ("موضة 2024", "trending_search"),
        ("fashionable tiyab", "trending_search"),

        # Ambiguous (low confidence)
        ("shi 7ilo", "product_search"),
        ("something nice", "product_search"),
        ("بدي أشتري", "product_search"),
    ]

    correct = 0
    total = len(test_cases)
    results = []

    print("Query → Predicted (Expected) [Confidence]")
    print("-" * 50)

    for query, expected in test_cases:
        try:
            predicted, confidence = trainer.predict(query)
            is_correct = predicted == expected
            if is_correct:
                correct += 1

            status = "✅" if is_correct else "❌"
            print(f"{status} {query[:30]:<30} → {predicted} ({expected}) [{confidence:.2f}]")

            results.append({
                'query': query,
                'expected': expected,
                'predicted': predicted,
                'confidence': confidence,
                'correct': is_correct
            })

        except Exception as e:
            print(f"❌ {query} → ERROR: {e}")
            results.append({
                'query': query,
                'expected': expected,
                'predicted': 'ERROR',
                'confidence': 0.0,
                'correct': False
            })

    accuracy = correct / total
    avg_confidence = sum(r['confidence'] for r in results if r['predicted'] != 'ERROR') / len(results)

    print(f"\n📊 Results:")
    print(f"   Accuracy: {accuracy:.1%} ({correct}/{total})")
    print(f"   Avg Confidence: {avg_confidence:.3f}")

    # Analyze by intent type
    intent_stats = {}
    for result in results:
        intent = result['expected']
        if intent not in intent_stats:
            intent_stats[intent] = {'correct': 0, 'total': 0, 'confidence': []}

        intent_stats[intent]['total'] += 1
        if result['correct']:
            intent_stats[intent]['correct'] += 1
        if result['predicted'] != 'ERROR':
            intent_stats[intent]['confidence'].append(result['confidence'])

    print(f"\n📈 Per-Intent Performance:")
    for intent, stats in intent_stats.items():
        intent_acc = stats['correct'] / stats['total']
        avg_conf = sum(stats['confidence']) / len(stats['confidence']) if stats['confidence'] else 0
        print(f"   {intent:<20}: {intent_acc:.1%} accuracy, {avg_conf:.2f} confidence")

    return {
        'model_path': model_path,
        'overall_accuracy': accuracy,
        'avg_confidence': avg_confidence,
        'intent_stats': intent_stats,
        'results': results
    }

def compare_models():
    """Compare all trained models"""
    print("🚀 Lebanese Fashion Intent Classifier - Model Comparison")
    print("=" * 60)

    models = [
        "models/intent_classifier_logistic.pkl",
        "models/intent_classifier_rf.pkl",
        "models/intent_classifier_nb.pkl"
    ]

    dataset_path = "data/intent_training_dataset_lebanese.txt"
    evaluations = []

    for model_path in models:
        if os.path.exists(model_path):
            eval_result = evaluate_model(model_path, dataset_path)
            if eval_result:
                evaluations.append(eval_result)

    if not evaluations:
        print("❌ No trained models found. Please train models first.")
        return

    # Overall comparison
    print(f"\n🏆 Model Comparison Summary:")
    print("=" * 60)
    print(f"{'Model':<25} {'Accuracy':<12} {'Avg Confidence':<15}")
    print("-" * 60)

    best_accuracy = 0
    best_model = None

    for eval_result in evaluations:
        model_name = os.path.basename(eval_result['model_path']).replace('.pkl', '')
        accuracy = eval_result['overall_accuracy']
        confidence = eval_result['avg_confidence']

        print(f"{model_name:<25} {accuracy:<12.1%} {confidence:<15.3f}")

        if accuracy > best_accuracy:
            best_accuracy = accuracy
            best_model = model_name

    print(f"\n🥇 Best Model: {best_model} ({best_accuracy:.1%} accuracy)")

    # Language-specific performance analysis
    print(f"\n🌍 Language Mix Analysis:")
    print("Testing with different language combinations...")

    language_test_cases = [
        ("English", ["shoes under 50 dollars", "men sneakers", "nike vs adidas"]),
        ("Arabic", ["أحذية بـ 50 ليرة", "أحذية رجالي", "مقارنة هواتف"]),
        ("Arabizi", ["shoes t7at 50 lira", "fsat nisai", "nike wala adidas"]),
        ("Mixed", ["shoes أحذية", "men رجالي", "trending موضة"])
    ]

    for eval_result in evaluations:
        model_name = os.path.basename(eval_result['model_path']).replace('.pkl', '')
        print(f"\n{model_name}:")

        trainer = IntentClassifierTrainer(dataset_path)
        trainer.load_model(eval_result['model_path'])

        for lang_name, queries in language_test_cases:
            total_conf = 0
            for query in queries:
                try:
                    _, confidence = trainer.predict(query)
                    total_conf += confidence
                except:
                    pass
            avg_conf = total_conf / len(queries) if queries else 0
            print(f"  {lang_name:<10}: {avg_conf:.3f} avg confidence")

def main():
    compare_models()

if __name__ == "__main__":
    main()

