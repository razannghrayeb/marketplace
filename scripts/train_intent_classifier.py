#!/usr/bin/env python3
"""
Intent Classification Model Training
Lebanese Fashion E-commerce Dataset

This script trains a lightweight intent classifier using fastText or transformers.
"""

import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import LabelEncoder
import fasttext
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class IntentClassifierTrainer:
    def __init__(self, dataset_path: str, model_type: str = "fasttext"):
        self.dataset_path = dataset_path
        self.model_type = model_type.lower()
        self.model = None
        self.label_encoder = LabelEncoder()

        # Supported model types
        self.SUPPORTED_MODELS = ["fasttext", "minilm", "distilbert"]

        if self.model_type not in self.SUPPORTED_MODELS:
            raise ValueError(f"Model type {model_type} not supported. Use one of: {self.SUPPORTED_MODELS}")

    def load_dataset(self) -> pd.DataFrame:
        """Load and preprocess the Lebanese fashion dataset"""
        logger.info(f"Loading dataset from {self.dataset_path}")

        data = []
        with open(self.dataset_path, 'r', encoding='utf-8') as f:
            for line in f:
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

        df = pd.DataFrame(data)
        logger.info(f"Loaded {len(df)} labeled queries")
        logger.info(f"Intent distribution:\n{df['intent'].value_counts()}")
        logger.info(f"Language distribution:\n{df['language'].value_counts()}")
        logger.info(f"Confidence distribution:\n{df['confidence'].value_counts()}")

        return df

    def prepare_data(self, df: pd.DataFrame):
        """Prepare data for training"""
        # Filter out low-confidence samples for cleaner training
        # (but keep some for robustness)
        high_conf = df[df['confidence'] == 'high']
        medium_conf = df[df['confidence'] == 'medium']
        low_conf = df[df['confidence'] == 'low'].sample(frac=0.5)  # Use 50% of low conf

        df_filtered = pd.concat([high_conf, medium_conf, low_conf]).reset_index(drop=True)
        logger.info(f"Using {len(df_filtered)} samples for training (filtered from {len(df)})")

        # Encode labels
        y = self.label_encoder.fit_transform(df_filtered['intent'])
        X = df_filtered['query'].tolist()

        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        return X_train, X_test, y_train, y_test, df_filtered

    def train_fasttext_model(self, X_train, y_train, X_test, y_test):
        """Train fastText model"""
        logger.info("Training fastText model...")

        # Prepare fastText format
        train_file = "/tmp/intent_train.txt"
        with open(train_file, 'w', encoding='utf-8') as f:
            for query, label_idx in zip(X_train, y_train):
                label_name = self.label_encoder.inverse_transform([label_idx])[0]
                # FastText expects format: __label__<label> <text>
                f.write(f"__label__{label_name} {query}\n")

        # Train model
        model = fasttext.train_supervised(
            input=train_file,
            epoch=25,
            lr=0.1,
            wordNgrams=2,
            dim=100,
            minCount=1
        )

        # Evaluate
        test_file = "/tmp/intent_test.txt"
        with open(test_file, 'w', encoding='utf-8') as f:
            for query, label_idx in zip(X_test, y_test):
                label_name = self.label_encoder.inverse_transform([label_idx])[0]
                f.write(f"__label__{label_name} {query}\n")

        # Get accuracy
        result = model.test(test_file)
        logger.info(f"FastText Results - Samples: {result[0]}, Precision: {result[1]:.3f}, Recall: {result[2]:.3f}")

        # Detailed evaluation
        y_pred = []
        for query in X_test:
            predictions = model.predict(query, k=1)
            pred_label = predictions[0][0].replace('__label__', '')
            pred_idx = self.label_encoder.transform([pred_label])[0]
            y_pred.append(pred_idx)

        # Classification report
        labels = self.label_encoder.classes_
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=labels))

        return model

    def train_transformer_model(self, X_train, y_train, X_test, y_test):
        """Train transformer model (MiniLM or DistilBERT)"""
        try:
            from transformers import (
                AutoTokenizer, AutoModelForSequenceClassification,
                TrainingArguments, Trainer, DataCollatorWithPadding
            )
            from datasets import Dataset
            import torch
        except ImportError:
            raise ImportError("transformers and torch required for transformer models")

        logger.info(f"Training {self.model_type} model...")

        # Choose model
        if self.model_type == "minilm":
            model_name = "microsoft/MiniLM-L6-v2"
        elif self.model_type == "distilbert":
            model_name = "distilbert-base-uncased"
        else:
            raise ValueError(f"Unknown transformer model: {self.model_type}")

        # Load tokenizer and model
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        num_labels = len(self.label_encoder.classes_)
        model = AutoModelForSequenceClassification.from_pretrained(
            model_name,
            num_labels=num_labels
        )

        # Tokenize data
        def tokenize_function(examples):
            return tokenizer(examples['text'], truncation=True, padding=True)

        # Create datasets
        train_dataset = Dataset.from_dict({
            'text': X_train,
            'labels': y_train
        })
        test_dataset = Dataset.from_dict({
            'text': X_test,
            'labels': y_test
        })

        train_dataset = train_dataset.map(tokenize_function, batched=True)
        test_dataset = test_dataset.map(tokenize_function, batched=True)

        # Training arguments
        training_args = TrainingArguments(
            output_dir='./intent_model',
            num_train_epochs=3,
            per_device_train_batch_size=16,
            per_device_eval_batch_size=16,
            warmup_steps=500,
            weight_decay=0.01,
            logging_dir='./logs',
            evaluation_strategy="epoch",
            save_strategy="epoch",
            load_best_model_at_end=True,
        )

        # Data collator
        data_collator = DataCollatorWithPadding(tokenizer)

        # Trainer
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=test_dataset,
            data_collator=data_collator,
        )

        # Train
        trainer.train()

        # Evaluate
        eval_results = trainer.evaluate()
        logger.info(f"Transformer Results: {eval_results}")

        return model, tokenizer

    def train(self):
        """Main training function"""
        # Load data
        df = self.load_dataset()
        X_train, X_test, y_train, y_test, df_filtered = self.prepare_data(df)

        logger.info(f"Training set: {len(X_train)} samples")
        logger.info(f"Test set: {len(X_test)} samples")

        # Train model based on type
        if self.model_type == "fasttext":
            self.model = self.train_fasttext_model(X_train, y_train, X_test, y_test)
        else:
            self.model = self.train_transformer_model(X_train, y_train, X_test, y_test)

        return self.model

    def save_model(self, output_path: str):
        """Save the trained model"""
        if self.model_type == "fasttext":
            self.model.save_model(output_path)
            logger.info(f"FastText model saved to {output_path}")
        else:
            self.model[0].save_pretrained(output_path)  # model
            self.model[1].save_pretrained(output_path)  # tokenizer
            logger.info(f"Transformer model saved to {output_path}")

    def test_predictions(self, test_queries: list):
        """Test model with sample queries"""
        logger.info("Testing model with sample queries:")

        for query in test_queries:
            if self.model_type == "fasttext":
                predictions = self.model.predict(query, k=3)
                labels = [p.replace('__label__', '') for p in predictions[0]]
                scores = predictions[1]
                print(f"Query: '{query}'")
                for label, score in zip(labels, scores):
                    print(f"  {label}: {score:.3f}")
            else:
                # TODO: Implement transformer prediction
                print(f"Query: '{query}' - Transformer prediction not implemented yet")
            print()

def main():
    """Main function to train the intent classifier"""
    import argparse

    parser = argparse.ArgumentParser(description="Train intent classifier for Lebanese fashion queries")
    parser.add_argument("--dataset", default="../data/intent_training_dataset_lebanese.txt", help="Dataset file path")
    parser.add_argument("--model", choices=["fasttext", "minilm", "distilbert"], default="fasttext", help="Model type")
    parser.add_argument("--output", default="./models/intent_classifier", help="Output model path")

    args = parser.parse_args()

    # Initialize trainer
    trainer = IntentClassifierTrainer(args.dataset, args.model)

    # Train model
    model = trainer.train()

    # Save model
    if args.model == "fasttext":
        trainer.save_model(args.output + ".bin")
    else:
        trainer.save_model(args.output)

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

if __name__ == "__main__":
    main()
