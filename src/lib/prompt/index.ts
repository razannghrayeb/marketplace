/**
 * Prompt & Intent Parsing Module
 * 
 * This module provides services for parsing user intent from images and text
 * using Google's Gemini AI model.
 */

export {
  IntentParserService,
  createIntentParser,
  // Types
  type DetectedItem,
  type AttributeMap,
  type ImageAnalysisResult,
  type ImageIntent,
  type SearchConstraints,
  type ParsedIntent,
  type IntentParserConfig
} from './gemeni';

// Re-export for convenience
export { IntentParserService as default } from './gemeni';
