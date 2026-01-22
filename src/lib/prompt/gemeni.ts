import { GoogleGenerativeAI, Part } from '@google/generative-ai';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface DetectedItem {
  category: string;
  confidence: number;
  boundingBox?: { x1: number; y1: number; x2: number; y2: number };
  attributes: Record<string, string>;
}

export interface AttributeMap {
  color?: string[];
  colorTone?: string;
  pattern?: string;
  material?: string;
  style?: string[];
  silhouette?: string;
  texture?: string;
  fit?: string;
  occasion?: string[];
  season?: string[];
  details?: string;
}

export interface ImageAnalysisResult {
  imageIndex: number;
  detected: DetectedItem[];
  attributes: AttributeMap;
  dominantColors?: string[];
  description?: string;
}

export interface ImageIntent {
  imageIndex: number;
  primaryAttributes: string[];
  extractedValues?: Record<string, string | string[]>;
  weight: number;
  reasoning: string;
}

export interface SearchConstraints {
  priceMin?: number;
  priceMax?: number;
  category?: string;
  brands?: string[];
  mustHave: string[];
  mustNotHave: string[];
  size?: string;
  gender?: string;
}

export interface ParsedIntent {
  imageIntents: ImageIntent[];
  constraints: SearchConstraints;
  searchStrategy: string;
  confidence: number;
  rawQuery?: string;
}

export interface IntentParserConfig {
  apiKey: string;
  model?: string;
  maxRetries?: number;
  timeout?: number;
}

// ============================================================================
// IntentParserService - Orchestrates multi-image intent extraction
// ============================================================================

export class IntentParserService {
  private client: GoogleGenerativeAI;
  private model: string;
  private maxRetries: number;
  private timeout: number;

  constructor(config: IntentParserConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-1.5-flash';
    this.maxRetries = config.maxRetries || 3;
    this.timeout = config.timeout || 30000;
  }

  // -------------------------------------------------------------------------
  // Main Entry Point: Parse user images + text to extract search intent
  // -------------------------------------------------------------------------
  async parseUserIntent(
    images: Buffer[],
    userPrompt: string,
    imageAnalyses?: ImageAnalysisResult[]
  ): Promise<ParsedIntent> {
    try {
      // Step 1: If no pre-analysis provided, analyze images first
      const analyses = imageAnalyses || await this.analyzeImages(images);

      // Step 2: Build the intent extraction prompt
      const prompt = this.buildIntentPrompt(analyses, userPrompt);

      // Step 3: Call Gemini API with images + prompt
      const response = await this.callGeminiWithRetry(images, prompt);

      // Step 4: Parse and validate the response
      const parsedIntent = this.parseIntentResponse(response);
      parsedIntent.rawQuery = userPrompt;

      return parsedIntent;

    } catch (error) {
      console.error('[IntentParserService] Error parsing intent:', error);
      // Return fallback intent on failure
      return this.createFallbackIntent(imageAnalyses || [], userPrompt);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Analyze images to extract fashion attributes
  // -------------------------------------------------------------------------
  async analyzeImages(images: Buffer[]): Promise<ImageAnalysisResult[]> {
    const analysisPrompt = `You are an expert fashion analyst. Analyze each image with extreme precision to extract attributes that can be used for cross-image mixing.

## CRITICAL: Image Indexing
- Images are numbered starting from 0 (first image = index 0, second = index 1, etc.)
- The user may refer to images as "first", "second", "1st", "2nd", "image 1", etc.
- "First image" or "Image 1" = imageIndex: 0
- "Second image" or "Image 2" = imageIndex: 1

## For EACH image, extract these attributes with HIGH SPECIFICITY:

### 1. COLORS (Be precise!)
- Primary color(s): The dominant color(s) covering most area
- Secondary color(s): Accent or detail colors
- Color tone: warm/cool, muted/vibrant, light/dark
- Provide hex codes when possible

### 2. TEXTURE & MATERIAL
- Material: leather, cotton, silk, denim, wool, velvet, suede, linen, polyester, knit, etc.
- Texture feel: smooth, rough, soft, crisp, fuzzy, shiny, matte, distressed, worn
- Surface details: quilted, ribbed, embossed, perforated, woven pattern

### 3. PATTERN
- Type: solid, striped, plaid, floral, geometric, abstract, animal print, polka dot, checkered
- Scale: micro, small, medium, large, oversized
- Contrast: high/low contrast

### 4. SILHOUETTE & FIT
- Silhouette: fitted, relaxed, oversized, A-line, straight, tapered, boxy, structured, flowy
- Fit: slim, regular, loose, cropped, longline, bodycon
- Length: cropped, regular, longline, midi, maxi

### 5. STYLE & VIBE
- Style: casual, formal, streetwear, vintage, minimalist, bohemian, preppy, edgy, romantic, sporty
- Era: 90s, Y2K, retro, modern, timeless
- Aesthetic: clean, distressed, polished, rugged, delicate

### 6. CONSTRUCTION DETAILS
- Neckline, collar type, sleeve style, closure type
- Hardware: buttons, zippers, buckles (color and style)
- Stitching: visible, contrast, minimal

Respond ONLY with valid JSON array (no markdown, no explanation):
[
  {
    "imageIndex": 0,
    "detected": [{"category": "jacket", "confidence": 0.95, "attributes": {"type": "bomber", "subtype": "classic"}}],
    "attributes": {
      "color": ["black", "silver"],
      "colorTone": "cool, dark",
      "pattern": "solid",
      "material": "leather",
      "texture": "smooth, slightly shiny",
      "style": ["edgy", "streetwear"],
      "silhouette": "fitted, structured",
      "fit": "regular",
      "occasion": ["casual", "evening"],
      "details": "ribbed cuffs, silver zipper hardware"
    },
    "dominantColors": ["#000000", "#C0C0C0"],
    "description": "Black leather bomber jacket with silver hardware, smooth finish, structured silhouette"
  }
]`;

    const response = await this.callGeminiWithRetry(images, analysisPrompt);
    
    try {
      const cleaned = this.cleanJsonResponse(response);
      return JSON.parse(cleaned) as ImageAnalysisResult[];
    } catch {
      // Return basic analysis on parse failure
      return images.map((_, idx) => ({
        imageIndex: idx,
        detected: [],
        attributes: {},
        description: 'Analysis failed'
      }));
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Build intent extraction prompt
  // -------------------------------------------------------------------------
  private buildIntentPrompt(
    imageAnalyses: ImageAnalysisResult[],
    userPrompt: string
  ): string {
    // Build a clear image reference guide
    const imageGuide = imageAnalyses.map((analysis, idx) => {
      const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][idx] || `image ${idx + 1}`;
      return `- Image ${idx} ("${ordinal} image", "image ${idx + 1}"): ${analysis.description || analysis.detected?.[0]?.category || 'fashion item'}`;
    }).join('\n');

    return `You are an expert fashion search AI specializing in understanding cross-image attribute requests.

## USER REQUEST
"${userPrompt}"

## IMAGE REFERENCE GUIDE
${imageGuide}

## DETAILED IMAGE ANALYSES
${JSON.stringify(imageAnalyses, null, 2)}

## CRITICAL: Understanding Image References
Users refer to images in various ways. Map them correctly:
| User Says | Maps To |
|-----------|----------|
| "first image", "1st", "image 1", "the first one" | imageIndex: 0 |
| "second image", "2nd", "image 2", "the second one" | imageIndex: 1 |
| "third image", "3rd", "image 3", "the third one" | imageIndex: 2 |
| "this one" (with single image) | imageIndex: 0 |
| "last image", "the last one" | highest imageIndex |

## ATTRIBUTE EXTRACTION RULES

When user says they want a specific attribute FROM a specific image, extract EXACTLY that:

### COLOR References
- "color from first image" → Extract exact colors from image 0
- "same color as second" → Extract colors from image 1
- "in that shade" → Identify which image, extract color + tone
- "darker/lighter version" → Modify the extracted color

### TEXTURE/MATERIAL References  
- "texture from image 2" → Extract material + texture feel from image 1
- "same fabric" → Extract material attribute
- "that leather look" → Extract material + surface finish
- "softer/rougher" → Modify texture descriptor

### SILHOUETTE/FIT References
- "fit like the first" → Extract silhouette + fit from image 0
- "same shape" → Extract silhouette
- "but more fitted/looser" → Modify fit attribute

### STYLE/VIBE References
- "style of image 1" → Extract style + aesthetic from image 0
- "same vibe" → Extract style + occasion
- "but more casual/formal" → Modify occasion attribute

### PATTERN References
- "pattern from second" → Extract pattern type + scale from image 1
- "same print" → Extract pattern details

## YOUR TASK

1. **Parse Image References**: Identify WHICH image each attribute request refers to
2. **Extract Specific Attributes**: Pull the EXACT attributes requested from each image
3. **Determine Weights**: How important is each image's contribution?
   - If user explicitly prioritizes one image, give it higher weight
   - If equal mention, distribute weights proportionally
4. **Build Search Strategy**: Describe how to combine attributes

## WEIGHT ASSIGNMENT GUIDE
- "mainly X, but with Y" → X gets 0.7, Y gets 0.3
- "X and Y equally" → Both get 0.5
- "X, Y, and Z" → Distribute based on emphasis (default 0.33 each)
- Single attribute mention → Full weight to that image for that attribute

## EXAMPLE INTERPRETATIONS

**User:** "I want the color of the first picture with the texture from the second"
→ Image 0: primaryAttributes: ["color"], weight: 0.5
→ Image 1: primaryAttributes: ["texture", "material"], weight: 0.5

**User:** "Something like the first one but in the color of the second"
→ Image 0: primaryAttributes: ["silhouette", "style", "fit"], weight: 0.6
→ Image 1: primaryAttributes: ["color"], weight: 0.4

**User:** "Mix the vintage style from image 1 with the modern cut from image 2"
→ Image 0: primaryAttributes: ["style"], weight: 0.5
→ Image 1: primaryAttributes: ["silhouette", "fit"], weight: 0.5

**User:** "I love the material and color from the first, just want it more fitted like the second"
→ Image 0: primaryAttributes: ["material", "texture", "color"], weight: 0.7
→ Image 1: primaryAttributes: ["fit", "silhouette"], weight: 0.3

Respond ONLY with valid JSON (no markdown, no explanation, no extra text):
{
  "imageIntents": [
    {
      "imageIndex": 0,
      "primaryAttributes": ["color", "colorTone"],
      "extractedValues": {"color": ["burgundy", "wine red"], "colorTone": "warm, rich"},
      "weight": 0.5,
      "reasoning": "User explicitly requested the color from the first image"
    },
    {
      "imageIndex": 1,
      "primaryAttributes": ["texture", "material"],
      "extractedValues": {"texture": "distressed, worn", "material": "leather"},
      "weight": 0.5,
      "reasoning": "User wants the texture/material feel from the second image"
    }
  ],
  "constraints": {
    "priceMax": null,
    "priceMin": null,
    "category": "jacket",
    "brands": [],
    "mustHave": ["leather", "burgundy", "distressed"],
    "mustNotHave": [],
    "size": null,
    "gender": null
  },
  "searchStrategy": "Search for leather jackets matching burgundy/wine color from image 0 combined with distressed leather texture from image 1",
  "confidence": 0.9
}`;
  }

  // -------------------------------------------------------------------------
  // Step 3: Call Gemini API with retry logic
  // -------------------------------------------------------------------------
  private async callGeminiWithRetry(
    images: Buffer[],
    prompt: string,
    attempt: number = 1
  ): Promise<string> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });

      // Build multimodal content parts
      const parts: Part[] = [
        // Add images first
        ...images.map((img) => ({
          inlineData: {
            mimeType: 'image/jpeg' as const,
            data: img.toString('base64')
          }
        })),
        // Then the text prompt
        { text: prompt }
      ];

      const result = await model.generateContent(parts);
      const response = result.response;
      const text = response.text();

      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      return text;

    } catch (error: any) {
      console.error(`[IntentParserService] Gemini API error (attempt ${attempt}):`, error.message);

      if (attempt < this.maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await this.sleep(delay);
        return this.callGeminiWithRetry(images, prompt, attempt + 1);
      }

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Parse and validate the intent response
  // -------------------------------------------------------------------------
  private parseIntentResponse(response: string): ParsedIntent {
    const cleaned = this.cleanJsonResponse(response);
    const parsed = JSON.parse(cleaned);

    // Validate and normalize
    this.validateParsedIntent(parsed);

    return parsed as ParsedIntent;
  }

  private cleanJsonResponse(response: string): string {
    let cleaned = response.trim();
    
    // Remove markdown code blocks
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```\n?/g, '');
    }

    // Remove any trailing content after JSON
    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    const lastIndex = Math.max(lastBrace, lastBracket);
    if (lastIndex > 0) {
      cleaned = cleaned.substring(0, lastIndex + 1);
    }

    return cleaned.trim();
  }

  private validateParsedIntent(parsed: any): void {
    // Validate imageIntents exists
    if (!parsed.imageIntents || !Array.isArray(parsed.imageIntents)) {
      throw new Error('Missing or invalid imageIntents array');
    }

    // Validate each intent
    for (const intent of parsed.imageIntents) {
      if (typeof intent.imageIndex !== 'number') {
        throw new Error('Invalid imageIndex in intent');
      }
      if (!Array.isArray(intent.primaryAttributes)) {
        intent.primaryAttributes = [];
      }
      if (typeof intent.weight !== 'number') {
        intent.weight = 1.0 / parsed.imageIntents.length;
      }
      if (typeof intent.reasoning !== 'string') {
        intent.reasoning = '';
      }
    }

    // Normalize weights to sum to 1.0
    const totalWeight = parsed.imageIntents.reduce(
      (sum: number, intent: ImageIntent) => sum + intent.weight,
      0
    );

    if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.01) {
      parsed.imageIntents.forEach((intent: ImageIntent) => {
        intent.weight = intent.weight / totalWeight;
      });
    }

    // Ensure constraints object exists
    if (!parsed.constraints) {
      parsed.constraints = { mustHave: [], mustNotHave: [] };
    }
    if (!Array.isArray(parsed.constraints.mustHave)) {
      parsed.constraints.mustHave = [];
    }
    if (!Array.isArray(parsed.constraints.mustNotHave)) {
      parsed.constraints.mustNotHave = [];
    }

    // Ensure other required fields
    if (typeof parsed.searchStrategy !== 'string') {
      parsed.searchStrategy = 'Balanced search across all images';
    }
    if (typeof parsed.confidence !== 'number') {
      parsed.confidence = 0.5;
    }
  }

  // -------------------------------------------------------------------------
  // Fallback: Create basic intent when API fails
  // -------------------------------------------------------------------------
  private createFallbackIntent(
    imageAnalyses: ImageAnalysisResult[],
    userPrompt: string
  ): ParsedIntent {
    const numImages = Math.max(imageAnalyses.length, 1);
    const weight = 1.0 / numImages;
    
    // Try to extract image references from prompt
    const imageRefs = this.extractImageReferences(userPrompt);
    const attributeRefs = this.extractAttributeReferences(userPrompt);

    return {
      imageIntents: imageAnalyses.length > 0
        ? imageAnalyses.map((analysis, idx) => {
            // Check if this image was specifically referenced
            const referencedAttrs = imageRefs
              .filter(ref => ref.imageIndex === idx)
              .flatMap(ref => ref.attributes);
            
            return {
              imageIndex: idx,
              primaryAttributes: referencedAttrs.length > 0 
                ? referencedAttrs 
                : ['color', 'style', 'silhouette', 'texture'],
              extractedValues: analysis.attributes as Record<string, string | string[]>,
              weight: referencedAttrs.length > 0 ? 0.6 : weight,
              reasoning: referencedAttrs.length > 0 
                ? `Fallback: User referenced ${referencedAttrs.join(', ')} from this image`
                : 'Fallback: Equal weight distribution'
            };
          })
        : [{
            imageIndex: 0,
            primaryAttributes: attributeRefs.length > 0 ? attributeRefs : ['color', 'style', 'silhouette'],
            weight: 1.0,
            reasoning: 'Fallback: Single image default'
          }],
      constraints: {
        mustHave: this.extractKeywordsFromPrompt(userPrompt),
        mustNotHave: []
      },
      searchStrategy: 'Balanced search using detected attributes from referenced images',
      confidence: 0.3,
      rawQuery: userPrompt
    };
  }

  // -------------------------------------------------------------------------
  // Utility: Extract image references from user prompt (fallback parsing)
  // -------------------------------------------------------------------------
  private extractImageReferences(prompt: string): Array<{imageIndex: number; attributes: string[]}> {
    const refs: Array<{imageIndex: number; attributes: string[]}> = [];
    const lowerPrompt = prompt.toLowerCase();
    
    // Pattern: "color/texture/etc from/of first/second/1st/2nd/image 1/etc"
    const patterns = [
      { regex: /(?:color|colour)s?\s+(?:from|of)\s+(?:the\s+)?(?:first|1st|image\s*1)/gi, idx: 0, attr: 'color' },
      { regex: /(?:color|colour)s?\s+(?:from|of)\s+(?:the\s+)?(?:second|2nd|image\s*2)/gi, idx: 1, attr: 'color' },
      { regex: /(?:color|colour)s?\s+(?:from|of)\s+(?:the\s+)?(?:third|3rd|image\s*3)/gi, idx: 2, attr: 'color' },
      { regex: /(?:texture|material|fabric)\s+(?:from|of)\s+(?:the\s+)?(?:first|1st|image\s*1)/gi, idx: 0, attr: 'texture' },
      { regex: /(?:texture|material|fabric)\s+(?:from|of)\s+(?:the\s+)?(?:second|2nd|image\s*2)/gi, idx: 1, attr: 'texture' },
      { regex: /(?:texture|material|fabric)\s+(?:from|of)\s+(?:the\s+)?(?:third|3rd|image\s*3)/gi, idx: 2, attr: 'texture' },
      { regex: /(?:style|vibe|aesthetic)\s+(?:from|of)\s+(?:the\s+)?(?:first|1st|image\s*1)/gi, idx: 0, attr: 'style' },
      { regex: /(?:style|vibe|aesthetic)\s+(?:from|of)\s+(?:the\s+)?(?:second|2nd|image\s*2)/gi, idx: 1, attr: 'style' },
      { regex: /(?:style|vibe|aesthetic)\s+(?:from|of)\s+(?:the\s+)?(?:third|3rd|image\s*3)/gi, idx: 2, attr: 'style' },
      { regex: /(?:fit|silhouette|shape|cut)\s+(?:from|of|like)\s+(?:the\s+)?(?:first|1st|image\s*1)/gi, idx: 0, attr: 'silhouette' },
      { regex: /(?:fit|silhouette|shape|cut)\s+(?:from|of|like)\s+(?:the\s+)?(?:second|2nd|image\s*2)/gi, idx: 1, attr: 'silhouette' },
      { regex: /(?:fit|silhouette|shape|cut)\s+(?:from|of|like)\s+(?:the\s+)?(?:third|3rd|image\s*3)/gi, idx: 2, attr: 'silhouette' },
      { regex: /(?:pattern|print)\s+(?:from|of)\s+(?:the\s+)?(?:first|1st|image\s*1)/gi, idx: 0, attr: 'pattern' },
      { regex: /(?:pattern|print)\s+(?:from|of)\s+(?:the\s+)?(?:second|2nd|image\s*2)/gi, idx: 1, attr: 'pattern' },
      { regex: /(?:pattern|print)\s+(?:from|of)\s+(?:the\s+)?(?:third|3rd|image\s*3)/gi, idx: 2, attr: 'pattern' },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(lowerPrompt)) {
        const existing = refs.find(r => r.imageIndex === pattern.idx);
        if (existing) {
          if (!existing.attributes.includes(pattern.attr)) {
            existing.attributes.push(pattern.attr);
          }
        } else {
          refs.push({ imageIndex: pattern.idx, attributes: [pattern.attr] });
        }
      }
    }

    return refs;
  }

  // -------------------------------------------------------------------------
  // Utility: Extract attribute references from prompt
  // -------------------------------------------------------------------------
  private extractAttributeReferences(prompt: string): string[] {
    const lowerPrompt = prompt.toLowerCase();
    const attributes: string[] = [];
    
    const attrKeywords: Record<string, string[]> = {
      'color': ['color', 'colour', 'shade', 'hue', 'tone'],
      'texture': ['texture', 'material', 'fabric', 'feel'],
      'silhouette': ['silhouette', 'shape', 'cut', 'fit', 'fitting'],
      'style': ['style', 'vibe', 'aesthetic', 'look'],
      'pattern': ['pattern', 'print', 'design']
    };

    for (const [attr, keywords] of Object.entries(attrKeywords)) {
      if (keywords.some(kw => lowerPrompt.includes(kw))) {
        attributes.push(attr);
      }
    }

    return attributes;
  }

  // -------------------------------------------------------------------------
  // Utility: Extract basic keywords from user prompt
  // -------------------------------------------------------------------------
  private extractKeywordsFromPrompt(prompt: string): string[] {
    const fashionKeywords = [
      'jacket', 'coat', 'dress', 'shirt', 'pants', 'jeans', 'skirt', 'top',
      'leather', 'cotton', 'silk', 'denim', 'wool', 'linen',
      'black', 'white', 'red', 'blue', 'green', 'brown', 'beige', 'navy',
      'fitted', 'oversized', 'cropped', 'slim', 'loose',
      'casual', 'formal', 'vintage', 'modern', 'minimalist', 'streetwear'
    ];

    const lowerPrompt = prompt.toLowerCase();
    return fashionKeywords.filter(keyword => lowerPrompt.includes(keyword));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory function for easy instantiation
// ============================================================================

export function createIntentParser(apiKey: string): IntentParserService {
  return new IntentParserService({ apiKey });
}
