/**
 * Wardrobe Image Recognition Service
 *
 * Uses AI to automatically analyze and categorize wardrobe photos.
 * Extracts:
 * - Category (shirt, pants, dress, etc.)
 * - Colors (primary, secondary)
 * - Pattern (solid, striped, floral, etc.)
 * - Material (cotton, leather, denim, etc.)
 * - Style attributes (casual, formal, etc.)
 */

import { IntentParserService, resolveGeminiGenerationModel } from '../prompt/gemeni';
import { getYOLOv8Client, type Detection } from '../image/yolov8Client';
import { mapDetectionToCategory } from '../detection/categoryMapper';
import { processImageForEmbedding } from '../image/processor';

// ============================================================================
// Types
// ============================================================================

export interface WardrobeItemAnalysis {
  category: string;
  categoryId?: number;
  subcategory?: string;
  confidence: number;

  colors: {
    primary: string[];
    secondary: string[];
    dominantHex: string[];
  };

  pattern?: string;
  patternId?: number;

  material?: string;
  materialId?: number;

  attributes: {
    style?: string[];
    occasion?: string[];
    season?: string[];
    fit?: string;
    neckline?: string;
    sleeveLength?: string;
  };

  description: string;
  suggestedName: string;

  embedding: number[];

  metadata: {
    detectionMethod: 'yolo' | 'gemini' | 'hybrid';
    processingTimeMs: number;
  };
}

export interface EnrichedWardrobeItem extends WardrobeItemAnalysis {
  tags: string[];
  searchableText: string;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze a wardrobe photo using AI
 */
export async function analyzeWardrobePhoto(
  imageBuffer: Buffer,
  options: {
    useGemini?: boolean;     // Use Gemini for enhanced analysis (default: true)
    extractEmbedding?: boolean; // Extract CLIP embedding (default: true)
    minConfidence?: number;  // Minimum YOLO confidence (default: 0.6)
  } = {}
): Promise<WardrobeItemAnalysis> {
  const startTime = Date.now();
  const {
    useGemini = true,
    extractEmbedding = true,
    minConfidence = 0.6,
  } = options;

  try {
    // Step 1: YOLO detection for fast category detection
    const client = getYOLOv8Client();
    const detectionResponse = await client.detectFromBuffer(imageBuffer);

    let category = 'unknown';
    let confidence = 0;
    let detectionMethod: 'yolo' | 'gemini' | 'hybrid' = 'yolo';

    if (detectionResponse.success && detectionResponse.detections && detectionResponse.detections.length > 0) {
      // Get best detection
      const bestDetection = detectionResponse.detections.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      // Only use YOLO if confidence meets threshold
      if (bestDetection.confidence >= minConfidence) {
        const mapping = mapDetectionToCategory(bestDetection.label, bestDetection.confidence);
        category = mapping.productCategory;
        confidence = mapping.confidence;
      }
    }

    // Step 2: Gemini analysis for rich attributes
    let geminiAnalysis: any = null;
    if (useGemini) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        geminiAnalysis = await analyzeWithGemini(imageBuffer, apiKey, category);
        detectionMethod = detectionResponse.success && detectionResponse.detections && detectionResponse.detections.length > 0 ? 'hybrid' : 'gemini';

        // Use Gemini's category if YOLO failed or has low confidence
        if (geminiAnalysis && (confidence < 0.7 || category === 'unknown')) {
          category = geminiAnalysis.category || category;
          confidence = Math.max(confidence, 0.85); // Gemini is generally reliable
        }
      }
    }

    // Step 3: Extract CLIP embedding for similarity search
    const embedding = extractEmbedding
      ? await processImageForEmbedding(imageBuffer)
      : [];

    // Step 4: Combine results
    const analysis: WardrobeItemAnalysis = {
      category,
      confidence,
      subcategory: geminiAnalysis?.subcategory,

      colors: {
        primary: geminiAnalysis?.colors?.primary || [],
        secondary: geminiAnalysis?.colors?.secondary || [],
        dominantHex: geminiAnalysis?.colors?.hexCodes || [],
      },

      pattern: geminiAnalysis?.pattern,
      material: geminiAnalysis?.material,

      attributes: {
        style: geminiAnalysis?.style || [],
        occasion: geminiAnalysis?.occasion || [],
        season: geminiAnalysis?.season || [],
        fit: geminiAnalysis?.fit,
        neckline: geminiAnalysis?.neckline,
        sleeveLength: geminiAnalysis?.sleeveLength,
      },

      description: geminiAnalysis?.description || `${category} item`,
      suggestedName: generateSuggestedName(category, geminiAnalysis),

      embedding,

      metadata: {
        detectionMethod,
        processingTimeMs: Date.now() - startTime,
      },
    };

    return analysis;

  } catch (error) {
    console.error('[WardrobeImageRecognition] Analysis error:', error);
    throw new Error(`Failed to analyze wardrobe photo: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Batch analyze multiple wardrobe photos
 */
export async function batchAnalyzeWardrobePhotos(
  images: Buffer[],
  options: Parameters<typeof analyzeWardrobePhoto>[1] = {}
): Promise<WardrobeItemAnalysis[]> {
  const results: WardrobeItemAnalysis[] = [];

  for (const imageBuffer of images) {
    const analysis = await analyzeWardrobePhoto(imageBuffer, options);
    results.push(analysis);
  }

  return results;
}

// ============================================================================
// Gemini Analysis
// ============================================================================

/**
 * Use Gemini Vision API for deep attribute extraction
 */
async function analyzeWithGemini(
  imageBuffer: Buffer,
  apiKey: string,
  hintCategory?: string
): Promise<any> {
  try {
    const intentParser = new IntentParserService({ apiKey });

    const prompt = `You are an expert fashion analyst. Analyze this single wardrobe item image with extreme precision.

${hintCategory && hintCategory !== 'unknown' ? `Detected category hint: ${hintCategory}` : ''}

Extract the following attributes:

1. **Category & Type:**
   - Main category (dress, top, bottom, outerwear, footwear, accessory)
   - Specific type (e.g., "maxi dress", "crew neck t-shirt", "skinny jeans")

2. **Colors (Be precise!):**
   - Primary color(s): The dominant color(s)
   - Secondary/accent colors
   - Provide hex codes if possible

3. **Pattern:**
   - Type: solid, striped, plaid, floral, geometric, animal print, polka dot, etc.
   - Scale: micro, small, medium, large

4. **Material:**
   - Primary material: cotton, leather, denim, silk, wool, polyester, etc.
   - Texture: smooth, rough, knit, woven, etc.

5. **Style Attributes:**
   - Style: casual, formal, sporty, bohemian, minimalist, streetwear, etc.
   - Occasion: everyday, work, formal event, party, athletic, lounge
   - Season: spring, summer, fall, winter, all-season

6. **Construction Details:**
   - Fit: slim, regular, loose, oversized
   - Neckline (if applicable): crew, v-neck, scoop, turtleneck, etc.
   - Sleeve length (if applicable): sleeveless, short, 3/4, long

7. **Description:**
   - 1-2 sentence human-readable description

Respond ONLY with valid JSON (no markdown):
{
  "category": "top",
  "subcategory": "crew neck t-shirt",
  "colors": {
    "primary": ["navy blue"],
    "secondary": ["white"],
    "hexCodes": ["#1E3A8A", "#FFFFFF"]
  },
  "pattern": "solid",
  "material": "cotton",
  "texture": "soft knit",
  "style": ["casual", "minimalist"],
  "occasion": ["everyday", "casual outing"],
  "season": ["spring", "summer", "fall"],
  "fit": "regular",
  "neckline": "crew neck",
  "sleeveLength": "short",
  "description": "Navy blue crew neck t-shirt in soft cotton knit with regular fit"
}`;

    const model = intentParser['client'].getGenerativeModel({
      model: resolveGeminiGenerationModel(),
    });

    const parts = [
      {
        inlineData: {
          mimeType: 'image/jpeg' as const,
          data: imageBuffer.toString('base64'),
        },
      },
      { text: prompt },
    ];

    const result = await model.generateContent(parts);
    const responseText = result.response.text();

    // Clean and parse JSON
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(cleaned);
    return parsed;

  } catch (error) {
    console.error('[WardrobeImageRecognition] Gemini analysis error:', error);
    return null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a suggested name for the item
 */
function generateSuggestedName(category: string, geminiData: any): string {
  if (!geminiData) {
    return category;
  }

  const parts: string[] = [];

  // Add color if available
  if (geminiData.colors?.primary?.length > 0) {
    parts.push(geminiData.colors.primary[0]);
  }

  // Add material if relevant
  if (geminiData.material && ['leather', 'denim', 'silk', 'wool'].includes(geminiData.material.toLowerCase())) {
    parts.push(geminiData.material);
  }

  // Add subcategory or category
  parts.push(geminiData.subcategory || category);

  return parts.join(' ');
}

/**
 * Enrich wardrobe item with searchable metadata
 */
export function enrichWardrobeItem(analysis: WardrobeItemAnalysis): EnrichedWardrobeItem {
  const tags: string[] = [];
  const searchableText: string[] = [];

  // Add category tags
  tags.push(analysis.category);
  if (analysis.subcategory) {
    tags.push(analysis.subcategory);
  }

  // Add color tags
  analysis.colors.primary.forEach(color => tags.push(color.toLowerCase()));
  analysis.colors.secondary.forEach(color => tags.push(color.toLowerCase()));

  // Add pattern tag
  if (analysis.pattern) {
    tags.push(analysis.pattern.toLowerCase());
  }

  // Add material tag
  if (analysis.material) {
    tags.push(analysis.material.toLowerCase());
  }

  // Add style tags
  if (analysis.attributes.style) {
    tags.push(...analysis.attributes.style.map(s => s.toLowerCase()));
  }

  // Add occasion tags
  if (analysis.attributes.occasion) {
    tags.push(...analysis.attributes.occasion.map(o => o.toLowerCase()));
  }

  // Add season tags
  if (analysis.attributes.season) {
    tags.push(...analysis.attributes.season.map(s => s.toLowerCase()));
  }

  // Build searchable text
  searchableText.push(
    analysis.category,
    analysis.subcategory || '',
    ...analysis.colors.primary,
    ...analysis.colors.secondary,
    analysis.pattern || '',
    analysis.material || '',
    analysis.description,
    ...tags
  );

  return {
    ...analysis,
    tags: [...new Set(tags)], // Remove duplicates
    searchableText: searchableText.filter(Boolean).join(' '),
  };
}

/**
 * Re-analyze existing wardrobe items (migration/update)
 */
export async function reanalyzeWardrobeItem(
  itemId: number,
  imageBuffer: Buffer
): Promise<WardrobeItemAnalysis> {
  return analyzeWardrobePhoto(imageBuffer, {
    useGemini: true,
    extractEmbedding: true,
    minConfidence: 0.5,
  });
}
