#!/usr/bin/env python3
"""
Intent Classification Model Training (Simplified)
Lebanese Fashion E-commerce Dataset

Uses scikit-learn classifiers instead of fastText to avoid compilation issues.
"""

import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.preprocessing import LabelEncoder
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
from sklearn.naive_bayes import MultinomialNB
from sklearn.linear_model import LogisticRegression
import pickle
import logging
import re

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class IntentClassifierTrainer:
    def __init__(self, dataset_path: str, model_type: str = "logistic"):
        self.dataset_path = dataset_path
        self.model_type = model_type.lower()
        self.model = None
        self.vectorizer = None
        self.label_encoder = LabelEncoder()

        # Supported model types
        self.SUPPORTED_MODELS = ["logistic", "svm", "random_forest", "naive_bayes"]

        if self.model_type not in self.SUPPORTED_MODELS:
            raise ValueError(f"Model type {model_type} not supported. Use one of: {self.SUPPORTED_MODELS}")

    def load_dataset(self) -> pd.DataFrame:
        """Load and preprocess the Lebanese fashion dataset"""
        logger.info(f"Loading dataset from {self.dataset_path}")

        data = []
        try:
            with open(self.dataset_path, 'r', encoding='utf-8') as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if line and not line.startswith('#'):
                        parts = line.split('|')
                        if len(parts) >= 4:
                            query, intent, confidence, language = parts[:4]
                            data.append({
                                'query': query.strip(),
                                'intent': intent.strip(),
                                'confidence': confidence.strip(),
                                'language': language.strip()
                            })
                        else:
                            logger.warning(f"Line {line_num}: Invalid format - {line}")
        except FileNotFoundError:
            logger.error(f"Dataset file not found: {self.dataset_path}")
            return pd.DataFrame()
        except Exception as e:
            logger.error(f"Error loading dataset: {e}")
            return pd.DataFrame()

        df = pd.DataFrame(data)
        logger.info(f"Loaded {len(df)} labeled queries")

        if len(df) > 0:
            logger.info(f"Intent distribution:\n{df['intent'].value_counts()}")
            logger.info(f"Language distribution:\n{df['language'].value_counts()}")
            logger.info(f"Confidence distribution:\n{df['confidence'].value_counts()}")

        return df

    def preprocess_text(self, text: str) -> str:
        """Preprocess text for better feature extraction"""
        # Convert to lowercase
        text = text.lower()

        # Handle Arabic numerals in Arabizi
        arabizi_map = {
            '2': 'a', '3': 'e', '5': 'kh', '6': 't', '7': 'h', '8': 'gh', '9': 'q'
        }
        for num, char in arabizi_map.items():
            text = text.replace(num, char)

        # Normalize spaces
        text = re.sub(r'\s+', ' ', text)

        return text.strip()

    def prepare_data(self, df: pd.DataFrame):
        """Prepare data for training"""
        if len(df) == 0:
            raise ValueError("No data available for training")

        # Filter out some low-confidence samples for cleaner training
        high_conf = df[df['confidence'] == 'high']
        medium_conf = df[df['confidence'] == 'medium']
        low_conf = df[df['confidence'] == 'low']

        # Use all data but log the distribution
        df_filtered = df.copy()
        logger.info(f"Using {len(df_filtered)} samples for training")
        logger.info(f"High confidence: {len(high_conf)}, Medium: {len(medium_conf)}, Low: {len(low_conf)}")

        # Preprocess queries
        df_filtered['processed_query'] = df_filtered['query'].apply(self.preprocess_text)

        # Encode labels
        y = self.label_encoder.fit_transform(df_filtered['intent'])
        X_text = df_filtered['processed_query'].tolist()

        # Vectorize text
        self.vectorizer = TfidfVectorizer(
            max_features=1000,
            ngram_range=(1, 2),
            min_df=1,
            max_df=0.95,
            stop_words='english'
        )

        X_sparse = self.vectorizer.fit_transform(X_text)

        # Convert to dense to avoid sparse matrix issues
        logger.info("Converting sparse matrix to dense array...")
        X = X_sparse.toarray()

        # Split data
        test_size = 0.2

        # Check if we can stratify
        from collections import Counter
        class_counts = Counter(y)
        min_class_count = min(class_counts.values())

        logger.info(f"Class distribution: {dict(class_counts)}")
        logger.info(f"Minimum class count: {min_class_count}")

        if min_class_count >= 4:  # Need at least 2 for train, 2 for test
            logger.info("Using stratified split")
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=test_size, random_state=42, stratify=y
            )
        else:
            logger.warning("Small dataset - using random split (no stratification)")
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=test_size, random_state=42
            )

        return X_train, X_test, y_train, y_test, df_filtered, X_text

    def train_model(self, X_train, y_train):
        """Train the selected model"""
        logger.info(f"Training {self.model_type} model...")

        if self.model_type == "logistic":
            self.model = LogisticRegression(random_state=42, max_iter=1000)
        elif self.model_type == "svm":
            self.model = SVC(kernel='linear', random_state=42, probability=True)
        elif self.model_type == "random_forest":
            self.model = RandomForestClassifier(n_estimators=100, random_state=42)
        elif self.model_type == "naive_bayes":
            self.model = MultinomialNB()

        self.model.fit(X_train, y_train)
        return self.model

    def evaluate_model(self, X_test, y_test):
        """Evaluate the trained model"""
        y_pred = self.model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)

        logger.info(f"Model Accuracy: {accuracy:.3f}")

        # Classification report
        labels = self.label_encoder.classes_
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=labels))

        # Confusion matrix
        print("\nConfusion Matrix:")
        cm = confusion_matrix(y_test, y_pred)
        print(cm)

        return accuracy, y_pred

    def train(self):
        """Main training function"""
        # Load data
        df = self.load_dataset()
        if len(df) == 0:
            raise ValueError("No data available for training")

        X_train, X_test, y_train, y_test, df_filtered, X_text = self.prepare_data(df)

        logger.info(f"Training set: {len(X_train)} samples")
        logger.info(f"Test set: {len(X_test)} samples")

        # Train model
        self.model = self.train_model(X_train, y_train)

        # Evaluate
        accuracy, y_pred = self.evaluate_model(X_test, y_test)

        return self.model, accuracy

    def save_model(self, output_path: str):
        """Save the trained model and vectorizer"""
        model_data = {
            'model': self.model,
            'vectorizer': self.vectorizer,
            'label_encoder': self.label_encoder,
            'model_type': self.model_type
        }

        with open(output_path, 'wb') as f:
            pickle.dump(model_data, f)

        logger.info(f"Model saved to {output_path}")

    def load_model(self, model_path: str):
        """Load a saved model"""
        with open(model_path, 'rb') as f:
            model_data = pickle.load(f)

        self.model = model_data['model']
        self.vectorizer = model_data['vectorizer']
        self.label_encoder = model_data['label_encoder']
        self.model_type = model_data['model_type']

        logger.info(f"Model loaded from {model_path}")

    def predict(self, query: str):
        """Predict intent for a single query"""
        if self.model is None or self.vectorizer is None:
            raise ValueError("Model not trained or loaded")

        processed_query = self.preprocess_text(query)
        query_vector_sparse = self.vectorizer.transform([processed_query])
        query_vector = query_vector_sparse.toarray()  # Convert to dense

        # Get prediction and probability
        prediction = self.model.predict(query_vector)[0]
        probabilities = self.model.predict_proba(query_vector)[0]

        intent = self.label_encoder.inverse_transform([prediction])[0]
        confidence = max(probabilities)

        return intent, confidence

    def test_predictions(self, test_queries: list):
        """Test model with sample queries"""
        logger.info("Testing model with sample queries:")

        for query in test_queries:
            try:
                intent, confidence = self.predict(query)
                print(f"Query: '{query}'")
                print(f"  Intent: {intent} (confidence: {confidence:.3f})")
                print()
            except Exception as e:
                print(f"Query: '{query}' - Error: {e}")
                print()

def main():
    """Main function to train the intent classifier"""
    import argparse

    parser = argparse.ArgumentParser(description="Train intent classifier for Lebanese fashion queries")
    parser.add_argument("--dataset", default="data/intent_training_dataset_lebanese.txt", help="Dataset file path")
    parser.add_argument("--model", choices=["logistic", "svm", "random_forest", "naive_bayes"], default="logistic", help="Model type")
    parser.add_argument("--output", default="models/intent_classifier.pkl", help="Output model path")

    args = parser.parse_args()

    # Create models directory
    os.makedirs("models", exist_ok=True)

    # Initialize trainer
    trainer = IntentClassifierTrainer(args.dataset, args.model)

    try:
        # Train model
        model, accuracy = trainer.train()

        # Save model
        trainer.save_model(args.output)

        print(f"\n🎉 Training completed!")
        print(f"📊 Final accuracy: {accuracy:.3f}")
        print(f"📁 Model saved to: {args.output}")

        # Test with sample Lebanese queries
        test_queries = [
            "shoes under 50 lira",           # price_search
            "men sneakers lebanon",          # product_search
            "nike vs adidas",                # comparison
            "zara",                          # brand_search
            "wedding dress outfit",          # outfit_completion
            "trending bags 2024",            # trending_search
            "shi 7ilo",                      # ambiguous (should use ML)
            "أحذية رجالي بيروت",            # Arabic product search
            "bags أقل من 100 ليرة"           # Mixed price search
        ]

        trainer.test_predictions(test_queries)

    except Exception as e:
        logger.error(f"Training failed: {e}")
        return 1

    return 0

if __name__ == "__main__":
    exit(main())




