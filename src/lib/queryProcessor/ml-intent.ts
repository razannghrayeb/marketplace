/**
 * ML Intent Classification
 *
 * Hybrid system: Rules first, ML fallback when confidence is low
 */

import { IntentResult } from "./intent";

export interface MLIntentResult {
  type: "price_search" | "product_search" | "comparison" | "brand_search" | "outfit_completion" | "trending_search";
  confidence: number; // 0-1
  source: "ml_model";
}

export interface MLModelConfig {
  enabled: boolean;
  modelPath?: string;
  minRuleConfidence: number; // Threshold to trigger ML
  modelType: "fasttext" | "minilm" | "distilbert" | "random_forest" | "logistic" | "naive_bayes";
}

/**
 * ML Intent Classifier - placeholder for future implementation
 */
export class MLIntentClassifier {
  private config: MLModelConfig;
  private model: any = null;
  private isLoaded = false;

  constructor(config: MLModelConfig) {
    this.config = config;
  }

  /**
   * Load the ML model (async)
   */
  async loadModel(): Promise<boolean> {
    if (!this.config.enabled || !this.config.modelPath) {
      return false;
    }

    try {
      // For scikit-learn models, we'll use Python subprocess
      if (["random_forest", "logistic", "naive_bayes"].includes(this.config.modelType)) {
        // Test if Python and model are available
        const { spawn } = require('child_process');
        const testScript = `
import pickle
import sys
import os
try:
    model_path = "${this.config.modelPath}"
    if os.path.exists(model_path):
        with open(model_path, 'rb') as f:
            pickle.load(f)
        print("SUCCESS")
    else:
        print("FILE_NOT_FOUND")
except Exception as e:
    print(f"ERROR: {e}")
`;

        const result = await this.runPython(testScript);
        if (result.includes("SUCCESS")) {
          this.isLoaded = true;
          console.log(`ML Intent model loaded: ${this.config.modelType}`);
          return true;
        } else {
          console.warn(`ML model test failed: ${result}`);
          return false;
        }
      } else {
        // TODO: Implement fastText/transformer loading
        throw new Error(`Model type ${this.config.modelType} not yet implemented`);
      }
    } catch (error) {
      console.error("Failed to load ML intent model:", error);
      return false;
    }
  }

  /**
   * Run Python script and return output
   */
  private async runPython(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const python = spawn('python', ['-c', script]);

      let output = '';
      let error = '';

      python.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      python.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });

      python.on('close', (code: number) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Python script failed: ${error}`));
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        python.kill();
        reject(new Error('Python script timeout'));
      }, 5000);
    });
  }

  /**
   * Predict intent using ML model
   */
  async predict(query: string): Promise<MLIntentResult | null> {
    if (!this.isLoaded) {
      return null;
    }

    try {
      // For scikit-learn models, use Python subprocess
      if (["random_forest", "logistic", "naive_bayes"].includes(this.config.modelType)) {
        const predictionScript = `
import pickle
import sys
import os
sys.path.append('${process.cwd()}/scripts')
from train_intent_simplified import IntentClassifierTrainer

try:
    trainer = IntentClassifierTrainer("data/intent_training_dataset_lebanese.txt")
    trainer.load_model("${this.config.modelPath}")
    intent, confidence = trainer.predict("${query.replace(/"/g, '\\"')}")
    print(f"{intent}|{confidence}")
except Exception as e:
    print(f"ERROR: {e}")
`;

        const result = await this.runPython(predictionScript);

        if (result.includes("ERROR:")) {
          console.warn(`ML prediction failed: ${result}`);
          return null;
        }

        const [intent, confidenceStr] = result.split('|');
        const confidence = parseFloat(confidenceStr);

        if (intent && !isNaN(confidence)) {
          return {
            type: intent as MLIntentResult["type"],
            confidence: confidence,
            source: "ml_model"
          };
        }
      }

      return null;
    } catch (error) {
      console.error("ML intent prediction failed:", error);
      return null;
    }
  }

  /**
   * Check if model is ready
   */
  isReady(): boolean {
    return this.isLoaded && this.model !== null;
  }
}

/**
 * Default ML configuration - Updated with best performing model
 */
export const DEFAULT_ML_CONFIG: MLModelConfig = {
  enabled: true, // Enable ML based on excellent evaluation results
  modelPath: "./models/intent_classifier_rf.pkl", // Use Random Forest (83.9% accuracy)
  minRuleConfidence: 0.7, // Use ML when rule confidence < 0.7
  modelType: "random_forest" // Best performing model type
};

// Global ML classifier instance
let mlClassifier: MLIntentClassifier | null = null;

/**
 * Initialize ML intent classifier
 */
export async function initializeMLIntentClassifier(config: MLModelConfig = DEFAULT_ML_CONFIG): Promise<boolean> {
  if (mlClassifier) {
    return mlClassifier.isReady();
  }

  mlClassifier = new MLIntentClassifier(config);
  return await mlClassifier.loadModel();
}

/**
 * Get ML prediction (internal use)
 */
export async function getMLIntentPrediction(query: string): Promise<MLIntentResult | null> {
  if (!mlClassifier || !mlClassifier.isReady()) {
    return null;
  }

  return await mlClassifier.predict(query);
}

/**
 * Check if ML should be used based on rule confidence
 */
export function shouldUseML(ruleResult: IntentResult, config: MLModelConfig = DEFAULT_ML_CONFIG): boolean {
  if (!config.enabled) {
    return false;
  }

  // Convert string confidence to number
  const confidenceScore = ruleResult.confidence === "high" ? 0.9 : 0.7;
  return confidenceScore < config.minRuleConfidence;
}
