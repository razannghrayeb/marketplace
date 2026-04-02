import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { parseNegations, type NegationConstraint } from '../queryProcessor/negationHandler';
import { parseSpatialRelationships, type SpatialConstraint } from '../queryProcessor/spatialRelationships';

/** Max images per multi-image search; ordinal rules and regex cover imageIndex 0..4. */
export const MAX_MULTI_IMAGE_UPLOADS = 5;

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface DetectedItem {
  category: string;
  confidence: number;
  boundingBox?: { x1: number; y1: number; x2: number; y2: number };
  attributes: Record<string, string>;
}

export interface SpatialDetail {
  attribute: string;      // e.g., "stripes", "embroidery"
  location: string;       // e.g., "sleeves", "collar"
  relationship: string;   // e.g., "on", "across"
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
  spatialDetails?: SpatialDetail[]; // NEW: Spatial relationships
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
  negativeAttributes?: {  // NEW: Structured negative constraints
    colors?: string[];
    patterns?: string[];
    materials?: string[];
    textures?: string[];
    styles?: string[];
    details?: string[];
  };
  spatialRequirements?: SpatialDetail[];  // NEW: Spatial relationships
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

/** Stable default for Google AI Studio generateContent; 1.5 short names often 404 on v1beta. */
export const DEFAULT_GEMINI_GENERATION_MODEL = 'gemini-2.5-flash';

/** Resolve model id: explicit config → GEMINI_MODEL env → default. */
export function resolveGeminiGenerationModel(explicit?: string): string {
  const a = explicit?.trim();
  if (a) return a;
  const b = process.env.GEMINI_MODEL?.trim();
  if (b) return b;
  return DEFAULT_GEMINI_GENERATION_MODEL;
}

/**
 * Gemini-free intent: equal image weights, no extracted text attributes or negatives.
 * Used when the API key is missing, a budget timeout fires, or callers skip vision LLM.
 */
export function createClipOnlyParsedIntent(imageCount: number, userPrompt: string): ParsedIntent {
  const n = Math.max(
    1,
    Math.min(Math.max(0, imageCount), MAX_MULTI_IMAGE_UPLOADS),
  );
  const w = 1 / n;
  return {
    imageIntents: Array.from({ length: n }, (_, i) => ({
      imageIndex: i,
      primaryAttributes: ["color", "style", "silhouette", "texture", "material", "pattern"],
      extractedValues: {},
      weight: w,
      reasoning: "CLIP-only fallback (Gemini unavailable, timed out, or skipped)",
    })),
    constraints: {
      mustHave: [],
      mustNotHave: [],
    },
    searchStrategy: "Visual similarity from uploaded images only",
    confidence: 0.15,
    rawQuery: userPrompt,
  };
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
    this.model = resolveGeminiGenerationModel(config.model);
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
    // Keep analyses for fallback if Gemini or JSON parse fails after vision succeeds.
    let analyses: ImageAnalysisResult[] = imageAnalyses ?? [];
    try {
      // Step 0: Pre-parse negations and spatial relationships
      const negationResult = parseNegations(userPrompt);
      const spatialResult = parseSpatialRelationships(userPrompt);

      // Use cleaned prompt for main analysis (negations/spatial removed)
      let workingPrompt = userPrompt;
      if (negationResult.hasNegation) {
        workingPrompt = negationResult.cleanedQuery;
      }
      if (spatialResult.hasSpatial) {
        workingPrompt = spatialResult.cleanedPrompt;
      }

      // Step 1: If no pre-analysis provided, analyze images first
      if (analyses.length === 0) {
        analyses = await this.analyzeImages(images);
      }

      // Step 2: Build the intent extraction prompt (with negations/spatial context)
      const prompt = this.buildIntentPrompt(
        analyses,
        workingPrompt,
        negationResult.negations,
        spatialResult.spatialConstraints
      );

      // Step 3: Call Gemini API with images + prompt
      const response = await this.callGeminiWithRetry(images, prompt);

      // Step 4: Parse and validate the response
      const parsedIntent = this.parseIntentResponse(response, analyses.length);
      parsedIntent.rawQuery = userPrompt;

      // Step 5: Merge pre-parsed constraints into the result
      this.mergePreParsedConstraints(
        parsedIntent,
        negationResult.negations,
        spatialResult.spatialConstraints
      );

      this.reconcileOrdinalImageIntents(parsedIntent, userPrompt, analyses);

      return parsedIntent;

    } catch (error) {
      console.error('[IntentParserService] Error parsing intent:', error);
      return this.createFallbackIntent(
        this.ensureAnalysesForFallback(analyses, images.length),
        userPrompt,
      );
    }
  }

  /**
   * When vision never produced rows (e.g. Gemini error before analyzeImages returns JSON),
   * emit one stub per uploaded image so multi-image prompt parsing and reconcile can use indices.
   */
  private ensureAnalysesForFallback(
    analyses: ImageAnalysisResult[],
    uploadCount: number,
  ): ImageAnalysisResult[] {
    if (analyses.length > 0) return analyses;
    const n = Math.max(1, Math.min(uploadCount, MAX_MULTI_IMAGE_UPLOADS));
    return Array.from({ length: n }, (_, idx) => ({
      imageIndex: idx,
      detected: [],
      attributes: {},
      description: 'Vision unavailable',
    }));
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
    userPrompt: string,
    negations: NegationConstraint[] = [],
    spatialConstraints: SpatialConstraint[] = []
  ): string {
    // Build a clear image reference guide
    const imageGuide = imageAnalyses.map((analysis, idx) => {
      const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][idx] || `image ${idx + 1}`;
      return `- Image ${idx} ("${ordinal} image", "image ${idx + 1}"): ${analysis.description || analysis.detected?.[0]?.category || 'fashion item'}`;
    }).join('\n');

    const n = imageAnalyses.length;
    const uploadRule =
      n >= 2
        ? `
## UPLOAD ORDER (NON-NEGOTIABLE)
The user uploaded **${n} images** in **fixed order** as separate image parts above: part 1 = **imageIndex 0**, part 2 = **imageIndex 1**, … part ${n} = **imageIndex ${n - 1}**.
- "first / 1st / image 1" → **imageIndex 0**
- "second / 2nd / image 2" → **imageIndex 1**
- "third / 3rd / image 3" → **imageIndex 2**
- "fourth / 4th / image 4" → **imageIndex 3**
- "fifth / 5th / image 5" → **imageIndex 4**
- "last / final image" → **imageIndex ${n - 1}**

**If the user asks for color (or texture, style, pattern, fit) FROM A SPECIFIC IMAGE (e.g. third, fifth, last), you MUST use that **imageIndex** for that attribute — never collapse everything onto imageIndex 0.**
When different attributes come from different images, output **one imageIntents object per image index that is referenced** (works for 2–${MAX_MULTI_IMAGE_UPLOADS} uploads: you may have several rows, each for a different imageIndex).

### COMMON MISTAKE TO AVOID
Wrong: one row with imageIndex 0 and primaryAttributes ["color","style"] when the user said color from the **second** (or third / last) image.
Right: separate rows — e.g. imageIndex 1 with ["color", ...] and imageIndex 0 with ["style", ...] when the user split attributes across images (same idea for third=2, fourth=3, fifth=4, last=${n - 1}).
`
        : '';

    return `You are an expert fashion search AI specializing in understanding cross-image attribute requests.

## USER REQUEST
"${userPrompt}"

## USER TEXT OVERRIDES IMAGES (NON-NEGOTIABLE)
Anything the user states in the request above about **category, garment type, colors, materials, patterns, fit, gender, price, brand, or exclusions** is a **hard shopping constraint**, not a soft hint.
- Fill \`constraints.category\`, \`constraints.gender\`, \`constraints.priceMin\` / \`constraints.priceMax\`, \`constraints.brands\`, \`constraints.mustHave\`, \`constraints.mustNotHave\`, and \`constraints.negativeAttributes\` from the **user's words first**.
- Use image analyses only where the user explicitly borrows a trait **from a named image** (e.g. "color from the second image") or where the user does **not** contradict the images.
- If the user says "only", "must", "has to be", "under $X", "women's", "no stripes", etc., encode that strictly in \`mustHave\` / \`mustNotHave\` / \`negativeAttributes\` and constraints — **never ignore it** in favor of visual similarity.

## IMAGE REFERENCE GUIDE
${imageGuide}

## DETAILED IMAGE ANALYSES
${JSON.stringify(imageAnalyses, null, 2)}
${uploadRule}
## CRITICAL: Understanding Image References
Users refer to images in various ways. Map them correctly:
| User Says | Maps To |
|-----------|----------|
| "first image", "1st", "image 1", "the first one" | imageIndex: 0 |
| "second image", "2nd", "image 2", "the second one" | imageIndex: 1 |
| "third image", "3rd", "image 3", "the third one" | imageIndex: 2 |
| "fourth image", "4th", "image 4" | imageIndex: 3 |
| "fifth image", "5th", "image 5" | imageIndex: 4 |
| "this one" (with single image) | imageIndex: 0 |
| "last image", "the last one", "final picture" | highest imageIndex (${n - 1} for ${n} uploads) |

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

## NEGATIVE CONSTRAINTS (What to AVOID)
${negations.length > 0 ? `
User has specified the following things to AVOID:
${negations.map(n => `- NO ${n.value} (${n.type}): "${n.originalText}"`).join('\n')}

**IMPORTANT**: These are EXCLUSIONS. Add them to mustNotHave array and negativeAttributes object.
` : ''}

## SPATIAL RELATIONSHIPS (Specific Placement)
${spatialConstraints.length > 0 ? `
User has specified WHERE attributes should appear:
${spatialConstraints.map(s => `- ${s.attribute} ${s.relationship} ${s.location}: "${s.originalPhrase}"`).join('\n')}

**IMPORTANT**: These specify LOCATION-SPECIFIC requirements. Add them to spatialRequirements array.
` : ''}

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

**User (2 of N uploads):** "Use the color from the second image and the style from the first"
→ Image 0: primaryAttributes: ["style"], extractedValues from analyses[0].attributes.style — weight: 0.5
→ Image 1: primaryAttributes: ["color", "colorTone"], extractedValues colors from analyses[1] — weight: 0.5
→ Do NOT assign both color and style to imageIndex 0.

**User (3+ uploads):** "Style from the first, color from the third, pattern like the last"
→ Image 0: primaryAttributes: ["style"], …
→ Image 2: primaryAttributes: ["color", "colorTone"], …
→ Image ${n - 1}: primaryAttributes: ["pattern"], … (last upload = imageIndex ${n - 1})
→ Use one row per referenced imageIndex; omit images the user did not mention unless needed for weights.

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
    "negativeAttributes": {
      "textures": [],
      "patterns": [],
      "materials": [],
      "colors": [],
      "styles": [],
      "details": []
    },
    "spatialRequirements": [],
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
  /** Detect MIME for Gemini inlineData (PNG/WebP uploads were mislabeled as JPEG). */
  private sniffImageMime(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    if (
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp';
    }
    return 'image/jpeg';
  }

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
            mimeType: this.sniffImageMime(img),
            data: img.toString('base64')
          }
        })),
        // Then the text prompt
        { text: prompt }
      ];

      const result = await Promise.race([
        model.generateContent(parts),
        new Promise<never>((_, rej) =>
          setTimeout(
            () => rej(new Error("GEMINI_CALL_TIMEOUT")),
            Math.max(1000, this.timeout),
          ),
        ),
      ]);
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
  private parseIntentResponse(response: string, uploadCount: number): ParsedIntent {
    const cleaned = this.cleanJsonResponse(response);
    const parsed = JSON.parse(cleaned);

    // Validate and normalize
    this.validateParsedIntent(parsed, uploadCount);

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

  private validateParsedIntent(parsed: any, uploadCount?: number): void {
    // Validate imageIntents exists
    if (!parsed.imageIntents || !Array.isArray(parsed.imageIntents)) {
      throw new Error('Missing or invalid imageIntents array');
    }

    if (parsed.imageIntents.length === 0) {
      throw new Error('Empty imageIntents array');
    }

    const maxIdx =
      uploadCount !== undefined
        ? Math.max(0, Math.min(uploadCount, MAX_MULTI_IMAGE_UPLOADS) - 1)
        : MAX_MULTI_IMAGE_UPLOADS - 1;

    // Validate each intent
    for (const intent of parsed.imageIntents) {
      if (typeof intent.imageIndex !== 'number') {
        throw new Error('Invalid imageIndex in intent');
      }
      intent.imageIndex = Math.max(0, Math.min(maxIdx, Math.trunc(intent.imageIndex)));
      if (!Array.isArray(intent.primaryAttributes)) {
        intent.primaryAttributes = [];
      }
      intent.primaryAttributes = intent.primaryAttributes.map((a: string) =>
        String(a || '').toLowerCase().trim()
      ).filter(Boolean);
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

  /**
   * Upload-order fragment for `imageIndex` (0 = first, …, 4 = fifth). Beyond 5, use generic image N.
   */
  private static ordinalFragmentForImageIndex(imageIndex: number): string {
    const frags = [
      '(?:first|1st|image\\s*1|pic\\s*1|picture\\s*1|photo\\s*1)',
      '(?:second|2nd|image\\s*2|pic\\s*2|picture\\s*2|photo\\s*2)',
      '(?:third|3rd|image\\s*3|pic\\s*3|picture\\s*3|photo\\s*3)',
      '(?:fourth|4th|image\\s*4|pic\\s*4|picture\\s*4|photo\\s*4)',
      '(?:fifth|5th|image\\s*5|pic\\s*5|picture\\s*5|photo\\s*5)',
    ];
    if (imageIndex >= 0 && imageIndex < frags.length) return frags[imageIndex];
    const n = imageIndex + 1;
    return `(?:image\\s*${n}|pic\\s*${n}|picture\\s*${n}|photo\\s*${n})`;
  }

  /**
   * True if the prompt ties `kind` to this upload slot (including "last/final" when `imageIndex` is the last upload).
   */
  private promptLinksAttributeToImage(
    prompt: string,
    kind: 'color' | 'style' | 'texture' | 'pattern' | 'silhouette',
    imageIndex: number,
    nImg: number,
  ): boolean {
    const o = IntentParserService.ordinalFragmentForImageIndex(imageIndex);
    const p = prompt;
    /** Between ordinal and attribute word, do not span " and " (avoids "X from first … and color from second" linking color to first). */
    const bridgeToAttr = '(?:(?!\\s+and\\s+)[^.!?\n]){0,80}';

    if (nImg >= 2 && imageIndex === nImg - 1) {
      if (kind === 'color') {
        if (
          /(?:colour|color)s?\s+(?:from|of|in)\s+(?:the\s+)?(?:last|final)(?:\s+(?:image|one|pic|picture|photo))?/i.test(
            p,
          ) ||
          new RegExp(
            `(?:from|of)\\s+(?:the\\s+)?(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:colour|color)`,
            'i',
          ).test(p) ||
          new RegExp(
            `(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:colour|color)`,
            'i',
          ).test(p)
        ) {
          return true;
        }
      } else if (kind === 'style') {
        if (
          /(?:style|vibe|aesthetic)s?\s+(?:from|of)\s+(?:the\s+)?(?:last|final)(?:\s+(?:image|one|pic|picture|photo))?/i.test(
            p,
          ) ||
          new RegExp(
            `(?:from|of)\\s+(?:the\\s+)?(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:style|vibe|aesthetic)`,
            'i',
          ).test(p) ||
          new RegExp(
            `(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:style|vibe|aesthetic)`,
            'i',
          ).test(p)
        ) {
          return true;
        }
      } else if (kind === 'texture') {
        if (
          /(?:texture|material|fabric)\s+(?:from|of)\s+(?:the\s+)?(?:last|final)(?:\s+(?:image|one|pic|picture|photo))?/i.test(
            p,
          ) ||
          new RegExp(
            `(?:from|of)\\s+(?:the\\s+)?(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:texture|material|fabric)`,
            'i',
          ).test(p) ||
          new RegExp(
            `(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:texture|material|fabric)`,
            'i',
          ).test(p)
        ) {
          return true;
        }
      } else if (kind === 'pattern') {
        if (
          /(?:pattern|print)\s+(?:from|of)\s+(?:the\s+)?(?:last|final)(?:\s+(?:image|one|pic|picture|photo))?/i.test(
            p,
          ) ||
          new RegExp(
            `(?:from|of)\\s+(?:the\\s+)?(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:pattern|print)`,
            'i',
          ).test(p) ||
          new RegExp(
            `(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:pattern|print)`,
            'i',
          ).test(p)
        ) {
          return true;
        }
      } else if (kind === 'silhouette') {
        if (
          /(?:fit|silhouette|shape|cut)\s+(?:from|of|like|in)\s+(?:the\s+)?(?:last|final)(?:\s+(?:image|one|pic|picture|photo))?/i.test(
            p,
          ) ||
          new RegExp(
            `(?:from|of|like|in)\\s+(?:the\\s+)?(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:fit|silhouette|shape|cut)`,
            'i',
          ).test(p) ||
          new RegExp(
            `(?:last|final)(?:\\s+(?:image|one|pic|picture|photo))?${bridgeToAttr}(?:fit|silhouette|shape|cut)`,
            'i',
          ).test(p)
        ) {
          return true;
        }
      }
    }

    if (kind === 'color') {
      return (
        new RegExp(`(?:colour|color)s?\\s+(?:from|of|in)\\s+(?:the\\s+)?${o}`, 'i').test(p) ||
        new RegExp(`(?:from|of)\\s+(?:the\\s+)?${o}${bridgeToAttr}(?:colour|color)`, 'i').test(p) ||
        new RegExp(`${o}${bridgeToAttr}(?:colour|color)`, 'i').test(p)
      );
    }
    if (kind === 'style') {
      return (
        new RegExp(`(?:style|vibe|aesthetic)s?\\s+(?:from|of)\\s+(?:the\\s+)?${o}`, 'i').test(p) ||
        new RegExp(`(?:from|of)\\s+(?:the\\s+)?${o}${bridgeToAttr}(?:style|vibe|aesthetic)`, 'i').test(p) ||
        new RegExp(`${o}${bridgeToAttr}(?:style|vibe|aesthetic)`, 'i').test(p)
      );
    }
    if (kind === 'texture') {
      return new RegExp(`(?:texture|material|fabric)\\s+(?:from|of)\\s+(?:the\\s+)?${o}`, 'i').test(p);
    }
    if (kind === 'pattern') {
      return new RegExp(`(?:pattern|print)\\s+(?:from|of)\\s+(?:the\\s+)?${o}`, 'i').test(p);
    }
    return (
      new RegExp(`(?:fit|silhouette|shape|cut)\\s+(?:from|of|like|in)\\s+(?:the\\s+)?${o}`, 'i').test(
        p,
      ) ||
      new RegExp(`(?:from|of|like|in)\\s+(?:the\\s+)?${o}${bridgeToAttr}(?:fit|silhouette|shape|cut)`, 'i').test(
        p,
      ) ||
      new RegExp(`${o}${bridgeToAttr}(?:fit|silhouette|shape|cut)`, 'i').test(p)
    );
  }

  /**
   * Gemini often collapses multi-image requests onto imageIndex 0. Repair when the user
   * clearly ties an attribute to an ordinal (supports up to 5 uploads + "last image").
   */
  private reconcileOrdinalImageIntents(
    parsed: ParsedIntent,
    rawPrompt: string,
    analyses: ImageAnalysisResult[],
  ): void {
    if (!analyses?.length || analyses.length < 2 || !parsed.imageIntents?.length) return;

    const p = rawPrompt;

    const analysisAt = (idx: number): ImageAnalysisResult | undefined =>
      analyses.find((a) => a.imageIndex === idx) ?? analyses[idx];

    const ensureIntent = (imageIndex: number): ImageIntent => {
      let row = parsed.imageIntents.find((ii) => ii.imageIndex === imageIndex);
      if (!row) {
        row = {
          imageIndex,
          primaryAttributes: [],
          weight: 1 / Math.max(parsed.imageIntents.length + 1, analyses.length),
          reasoning: `Reconciled from user ordinal → imageIndex ${imageIndex}`,
        };
        parsed.imageIntents.push(row);
      }
      if (!row.primaryAttributes) row.primaryAttributes = [];
      return row;
    };

    const copyColorsFromAnalysis = (target: ImageIntent, analysis: ImageAnalysisResult) => {
      const attrs = analysis.attributes || {};
      target.extractedValues = target.extractedValues || {};
      if (attrs.color) {
        target.extractedValues.color = Array.isArray(attrs.color)
          ? attrs.color.map(String)
          : [String(attrs.color)];
      }
      if (attrs.colorTone) target.extractedValues.colorTone = String(attrs.colorTone);
      for (const key of ['colour', 'colors'] as const) {
        const v = (attrs as Record<string, unknown>)[key];
        if (v != null && !target.extractedValues.color) {
          target.extractedValues.color = Array.isArray(v)
            ? (v as unknown[]).map(String)
            : [String(v)];
        }
      }
      for (const a of ['color', 'colortone'] as const) {
        if (!target.primaryAttributes.includes(a)) target.primaryAttributes.push(a);
      }
    };

    const stripAttributeFromIndex = (imageIndex: number, attrs: string[]) => {
      const row = parsed.imageIntents.find((ii) => ii.imageIndex === imageIndex);
      if (!row) return;
      const strip = new Set(attrs.map((a) => String(a).toLowerCase()));
      if (strip.has('color') || strip.has('colortone') || strip.has('colour')) {
        strip.add('color');
        strip.add('colour');
        strip.add('colors');
        strip.add('colortone');
      }
      row.primaryAttributes = (row.primaryAttributes || []).filter(
        (x) => !strip.has(String(x).toLowerCase()),
      );
      if (row.extractedValues) {
        const ev = row.extractedValues as Record<string, unknown>;
        if (strip.has('color')) {
          delete ev.color;
          delete ev.colour;
          delete ev.colors;
          delete ev.colorTone;
        }
        if (strip.has('style')) delete ev.style;
        if (strip.has('texture')) delete ev.texture;
        if (strip.has('material')) delete ev.material;
        if (strip.has('pattern')) delete ev.pattern;
        if (strip.has('silhouette') || strip.has('fit')) {
          delete ev.silhouette;
          delete ev.fit;
        }
      }
    };

    const copyStyleFromAnalysis = (target: ImageIntent, analysis: ImageAnalysisResult) => {
      const st = analysis.attributes?.style;
      target.extractedValues = target.extractedValues || {};
      if (Array.isArray(st)) target.extractedValues.style = st.map(String);
      else if (st) target.extractedValues.style = String(st);
      if (!target.primaryAttributes.includes('style')) target.primaryAttributes.push('style');
    };

    const copyTextureFromAnalysis = (target: ImageIntent, analysis: ImageAnalysisResult) => {
      const attrs = analysis.attributes || {};
      target.extractedValues = target.extractedValues || {};
      if (attrs.material) target.extractedValues.material = String(attrs.material);
      if (attrs.texture) target.extractedValues.texture = String(attrs.texture);
      for (const t of ['texture', 'material'] as const) {
        if (!target.primaryAttributes.includes(t)) target.primaryAttributes.push(t);
      }
    };

    const copyPatternFromAnalysis = (target: ImageIntent, analysis: ImageAnalysisResult) => {
      const pat = analysis.attributes?.pattern;
      target.extractedValues = target.extractedValues || {};
      if (pat) target.extractedValues.pattern = String(pat);
      if (!target.primaryAttributes.includes('pattern')) target.primaryAttributes.push('pattern');
    };

    const copySilhouetteFromAnalysis = (target: ImageIntent, analysis: ImageAnalysisResult) => {
      const attrs = analysis.attributes || {};
      target.extractedValues = target.extractedValues || {};
      if (attrs.silhouette) target.extractedValues.silhouette = String(attrs.silhouette);
      if (attrs.fit) target.extractedValues.fit = String(attrs.fit);
      for (const t of ['silhouette', 'fit'] as const) {
        if (attrs[t] != null && !target.primaryAttributes.includes(t)) target.primaryAttributes.push(t);
      }
    };

    const nImg = analyses.length;

    type OrdinalAttrKind = 'color' | 'style' | 'texture' | 'pattern' | 'silhouette';

    const soleSourceIndices = (kind: OrdinalAttrKind): number[] => {
      const out: number[] = [];
      for (let i = 0; i < nImg; i++) {
        if (this.promptLinksAttributeToImage(p, kind, i, nImg)) out.push(i);
      }
      return out;
    };

    const applyExclusiveAttribute = (kind: OrdinalAttrKind, label: string) => {
      const sources = soleSourceIndices(kind);
      if (sources.length !== 1) return;
      const sole = sources[0];
      const a = analysisAt(sole);
      if (!a) return;

      const tag = `${label} (imageIndex ${sole}, reconciled)`;

      if (kind === 'color') {
        for (let j = 0; j < nImg; j++) {
          if (j !== sole) stripAttributeFromIndex(j, ['color', 'colortone', 'colour']);
        }
        const row = ensureIntent(sole);
        copyColorsFromAnalysis(row, a);
        row.reasoning = (row.reasoning ? row.reasoning + ' | ' : '') + tag;
      } else if (kind === 'style') {
        for (let j = 0; j < nImg; j++) {
          if (j !== sole) stripAttributeFromIndex(j, ['style']);
        }
        const row = ensureIntent(sole);
        copyStyleFromAnalysis(row, a);
        row.reasoning = (row.reasoning ? row.reasoning + ' | ' : '') + tag;
      } else if (kind === 'texture') {
        for (let j = 0; j < nImg; j++) {
          if (j !== sole) stripAttributeFromIndex(j, ['texture', 'material']);
        }
        const row = ensureIntent(sole);
        copyTextureFromAnalysis(row, a);
        row.reasoning = (row.reasoning ? row.reasoning + ' | ' : '') + tag;
      } else if (kind === 'pattern') {
        for (let j = 0; j < nImg; j++) {
          if (j !== sole) stripAttributeFromIndex(j, ['pattern']);
        }
        const row = ensureIntent(sole);
        copyPatternFromAnalysis(row, a);
        row.reasoning = (row.reasoning ? row.reasoning + ' | ' : '') + tag;
      } else {
        for (let j = 0; j < nImg; j++) {
          if (j !== sole) stripAttributeFromIndex(j, ['silhouette', 'fit']);
        }
        const row = ensureIntent(sole);
        copySilhouetteFromAnalysis(row, a);
        row.reasoning = (row.reasoning ? row.reasoning + ' | ' : '') + tag;
      }
    };

    applyExclusiveAttribute('color', 'User tied color to one upload');
    applyExclusiveAttribute('style', 'User tied style to one upload');
    applyExclusiveAttribute('texture', 'User tied texture/material to one upload');
    applyExclusiveAttribute('pattern', 'User tied pattern to one upload');
    applyExclusiveAttribute('silhouette', 'User tied fit/silhouette to one upload');

    parsed.imageIntents = parsed.imageIntents.filter((ii) => {
      const pa = ii.primaryAttributes || [];
      const ev = ii.extractedValues;
      const hasVals = ev && Object.keys(ev).length > 0;
      return pa.length > 0 || Boolean(hasVals);
    });
    if (parsed.imageIntents.length === 0) return;

    const tw = parsed.imageIntents.reduce((s, ii) => s + (ii.weight || 0), 0);
    if (tw <= 0) {
      const w = 1 / parsed.imageIntents.length;
      parsed.imageIntents.forEach((ii) => {
        ii.weight = w;
      });
    } else {
      parsed.imageIntents.forEach((ii) => {
        ii.weight = (ii.weight || 0) / tw;
      });
    }

    const parts: string[] = [];
    for (const ii of parsed.imageIntents) {
      const attrs = (ii.primaryAttributes || []).join(', ');
      const pct = Math.round((ii.weight || 0) * 100);
      parts.push(`Image ${ii.imageIndex}: ${attrs} (${pct}% weight)`);
    }
    if (parts.length) {
      parsed.searchStrategy = parts.join(' | ');
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Merge pre-parsed constraints into parsed intent
  // -------------------------------------------------------------------------
  private mergePreParsedConstraints(
    parsedIntent: ParsedIntent,
    negations: NegationConstraint[],
    spatialConstraints: SpatialConstraint[]
  ): void {
    // Merge negative constraints
    if (negations.length > 0) {
      if (!parsedIntent.constraints.negativeAttributes) {
        parsedIntent.constraints.negativeAttributes = {};
      }

      for (const neg of negations) {
        const type = neg.type;
        const pluralType = `${type}s` as keyof NonNullable<typeof parsedIntent.constraints.negativeAttributes>;

        if (!parsedIntent.constraints.negativeAttributes[pluralType]) {
          parsedIntent.constraints.negativeAttributes[pluralType] = [];
        }

        // Add to typed array
        const arr = parsedIntent.constraints.negativeAttributes[pluralType] as string[];
        if (!arr.includes(neg.value)) {
          arr.push(neg.value);
        }

        // Also add to mustNotHave for backward compatibility
        if (!parsedIntent.constraints.mustNotHave.includes(neg.value)) {
          parsedIntent.constraints.mustNotHave.push(neg.value);
        }
      }
    }

    // Merge spatial constraints
    if (spatialConstraints.length > 0) {
      if (!parsedIntent.constraints.spatialRequirements) {
        parsedIntent.constraints.spatialRequirements = [];
      }

      for (const spatial of spatialConstraints) {
        // Convert SpatialConstraint to SpatialDetail format
        parsedIntent.constraints.spatialRequirements.push({
          attribute: spatial.attribute,
          location: spatial.location,
          relationship: spatial.relationship
        });
      }
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

    const imageRefs = this.extractImageReferences(userPrompt);
    const attributeRefs = this.extractAttributeReferences(userPrompt);

    const defaultAttrs = ['color', 'style', 'silhouette', 'texture'] as const;
    const hasAnyOrdinalRef = imageRefs.length > 0;

    let imageIntents: ImageIntent[] =
      imageAnalyses.length > 0
        ? imageAnalyses.map((analysis) => {
            const idx = analysis.imageIndex;
            const referencedAttrs = imageRefs
              .filter((ref) => ref.imageIndex === idx)
              .flatMap((ref) => ref.attributes);

            const primaryAttributes: string[] =
              referencedAttrs.length > 0
                ? referencedAttrs
                : hasAnyOrdinalRef
                  ? []
                  : [...defaultAttrs];

            const rawAttrs = (analysis.attributes || {}) as Record<string, string | string[]>;
            let extractedValues: Record<string, string | string[]>;
            if (!hasAnyOrdinalRef) {
              extractedValues = rawAttrs;
            } else if (primaryAttributes.length === 0) {
              extractedValues = {};
            } else {
              extractedValues = {};
              for (const a of primaryAttributes) {
                const canon = a === 'colour' ? 'color' : a;
                const v = rawAttrs[canon] ?? rawAttrs[a];
                if (v !== undefined) extractedValues[canon] = v;
              }
            }

            return {
              imageIndex: idx,
              primaryAttributes,
              extractedValues,
              weight: hasAnyOrdinalRef ? 1 : weight,
              reasoning:
                referencedAttrs.length > 0
                  ? `Fallback: User referenced ${referencedAttrs.join(', ')} from this image`
                  : hasAnyOrdinalRef
                    ? 'Fallback: No per-attribute mix for this image (global embedding only)'
                    : 'Fallback: Equal weight distribution',
            };
          })
        : [
            {
              imageIndex: 0,
              primaryAttributes:
                attributeRefs.length > 0 ? attributeRefs : ['color', 'style', 'silhouette'],
              weight: 1.0,
              reasoning: 'Fallback: Single image default',
            },
          ];

    imageIntents.sort((a, b) => a.imageIndex - b.imageIndex);

    const tw = imageIntents.reduce((s, ii) => s + (ii.weight || 0), 0);
    if (tw > 0) {
      imageIntents.forEach((ii) => {
        ii.weight = (ii.weight || 0) / tw;
      });
    }

    const parsed: ParsedIntent = {
      imageIntents,
      constraints: {
        mustHave: this.extractKeywordsFromPrompt(userPrompt),
        mustNotHave: [],
      },
      searchStrategy: 'Balanced search using detected attributes from referenced images',
      confidence: 0.3,
      rawQuery: userPrompt,
    };

    if (imageAnalyses.length >= 2) {
      this.reconcileOrdinalImageIntents(parsed, userPrompt, imageAnalyses);
    } else {
      const parts = imageIntents.map((ii) => {
        const attrs = (ii.primaryAttributes || []).join(', ');
        const pct = Math.round((ii.weight || 0) * 100);
        return `Image ${ii.imageIndex}: ${attrs} (${pct}% weight)`;
      });
      if (parts.length) parsed.searchStrategy = parts.join(' | ');
    }

    return parsed;
  }

  // -------------------------------------------------------------------------
  // Utility: Extract image references from user prompt (fallback parsing)
  // -------------------------------------------------------------------------
  private extractImageReferences(prompt: string): Array<{imageIndex: number; attributes: string[]}> {
    const refs: Array<{imageIndex: number; attributes: string[]}> = [];
    const lowerPrompt = prompt.toLowerCase();

    const ordinals = [
      String.raw`(?:first|1st|image\s*1|pic\s*1|picture\s*1|photo\s*1)`,
      String.raw`(?:second|2nd|image\s*2|pic\s*2|picture\s*2|photo\s*2)`,
      String.raw`(?:third|3rd|image\s*3|pic\s*3|picture\s*3|photo\s*3)`,
      String.raw`(?:fourth|4th|image\s*4|pic\s*4|picture\s*4|photo\s*4)`,
      String.raw`(?:fifth|5th|image\s*5|pic\s*5|picture\s*5|photo\s*5)`,
    ];
    const link = String.raw`(?:from|of|in)\s+(?:the\s+)?`;

    const patterns: { regex: RegExp; idx: number; attr: string }[] = [];
    for (let idx = 0; idx < ordinals.length; idx++) {
      const o = ordinals[idx];
      patterns.push(
        { regex: new RegExp(`(?:color|colour)s?\\s+${link}${o}`, 'gi'), idx, attr: 'color' },
        { regex: new RegExp(`(?:texture|material|fabric)\\s+${link}${o}`, 'gi'), idx, attr: 'texture' },
        { regex: new RegExp(`(?:style|vibe|aesthetic)s?\\s+${link}${o}`, 'gi'), idx, attr: 'style' },
        {
          regex: new RegExp(
            `(?:fit|silhouette|shape|cut)\\s+(?:from|of|like|in)\\s+(?:the\\s+)?${o}`,
            'gi',
          ),
          idx,
          attr: 'silhouette',
        },
        { regex: new RegExp(`(?:pattern|print)\\s+${link}${o}`, 'gi'), idx, attr: 'pattern' },
      );
    }

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
