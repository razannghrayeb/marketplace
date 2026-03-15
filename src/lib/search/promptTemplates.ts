/**
 * Prompt Templates and Suggestions for Multi-Image Composite Search
 *
 * Provides structured templates to help users craft effective prompts
 * for multi-image attribute mixing searches.
 */

// ============================================================================
// Types
// ============================================================================

export interface PromptTemplate {
  /** Template ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this template does */
  description: string;
  /** Example prompt using this template */
  example: string;
  /** Category for organization */
  category: PromptCategory;
  /** Difficulty level */
  difficulty: "beginner" | "intermediate" | "advanced";
  /** Number of images recommended for this template */
  recommendedImages: number;
  /** Whether this supports negative attributes */
  supportsNegatives: boolean;
  /** Whether this supports spatial relationships */
  supportsSpatial: boolean;
}

export type PromptCategory =
  | "attribute_mixing"
  | "style_fusion"
  | "color_palette"
  | "texture_material"
  | "pattern_design"
  | "spatial_control"
  | "negative_filtering"
  | "multi_image_blend";

export interface PromptSuggestion {
  /** What aspect to describe */
  aspect: string;
  /** Example phrases */
  examplePhrases: string[];
  /** Optional negative examples */
  negativeExamples?: string[];
}

export interface ParsedPromptStructure {
  /** Detected attributes being requested */
  attributes: string[];
  /** Negative constraints detected */
  negatives: string[];
  /** Spatial relationships detected */
  spatialRelations: Array<{ attribute: string; location: string }>;
  /** Color preferences */
  colors: string[];
  /** Style preferences */
  styles: string[];
  /** Material/texture preferences */
  materials: string[];
}

// ============================================================================
// Prompt Templates Library
// ============================================================================

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // ─── Beginner Templates ─────────────────────────────────────────────────
  {
    id: "simple-color-swap",
    name: "Color Swap",
    description: "Change the color of an item while keeping its style",
    example: "I want this dress style but in blue color",
    category: "attribute_mixing",
    difficulty: "beginner",
    recommendedImages: 1,
    supportsNegatives: false,
    supportsSpatial: false,
  },
  {
    id: "style-with-color",
    name: "Style + Specific Color",
    description: "Find items matching specific style and color combination",
    example: "Show me items with the style from image 1 in red or burgundy",
    category: "color_palette",
    difficulty: "beginner",
    recommendedImages: 1,
    supportsNegatives: false,
    supportsSpatial: false,
  },
  {
    id: "similar-but-different-color",
    name: "Similar Style, Different Color",
    description: "Find similar items in a different color palette",
    example: "Find similar tops to this but in pastel colors",
    category: "attribute_mixing",
    difficulty: "beginner",
    recommendedImages: 1,
    supportsNegatives: false,
    supportsSpatial: false,
  },

  // ─── Intermediate Templates ─────────────────────────────────────────────
  {
    id: "two-image-blend",
    name: "Blend Two Images",
    description: "Combine attributes from two different items",
    example: "I want the color from image 1 and the style from image 2",
    category: "multi_image_blend",
    difficulty: "intermediate",
    recommendedImages: 2,
    supportsNegatives: false,
    supportsSpatial: false,
  },
  {
    id: "texture-material-blend",
    name: "Texture + Material Blend",
    description: "Mix texture from one item with material from another",
    example: "Find items with the texture of image 1 but in leather material like image 2",
    category: "texture_material",
    difficulty: "intermediate",
    recommendedImages: 2,
    supportsNegatives: false,
    supportsSpatial: false,
  },
  {
    id: "pattern-on-different-item",
    name: "Pattern Transfer",
    description: "Apply a pattern from one item to a different item type",
    example: "Show me dresses with the floral pattern from this scarf",
    category: "pattern_design",
    difficulty: "intermediate",
    recommendedImages: 1,
    supportsNegatives: false,
    supportsSpatial: false,
  },
  {
    id: "with-negatives",
    name: "Style With Exclusions",
    description: "Find items matching criteria while excluding unwanted attributes",
    example: "I want tops like this but NOT too shiny and NOT with ruffles",
    category: "negative_filtering",
    difficulty: "intermediate",
    recommendedImages: 1,
    supportsNegatives: true,
    supportsSpatial: false,
  },

  // ─── Advanced Templates ─────────────────────────────────────────────────
  {
    id: "multi-attribute-fusion",
    name: "Multi-Attribute Fusion",
    description: "Combine 3+ attributes from multiple images",
    example: "Color from image 1, texture from image 2, pattern from image 3, on a casual dress",
    category: "multi_image_blend",
    difficulty: "advanced",
    recommendedImages: 3,
    supportsNegatives: false,
    supportsSpatial: false,
  },
  {
    id: "spatial-pattern-control",
    name: "Spatial Pattern Control",
    description: "Specify where patterns or details should appear",
    example: "Find sweaters with stripes on the sleeves and solid color on the body",
    category: "spatial_control",
    difficulty: "advanced",
    recommendedImages: 1,
    supportsNegatives: false,
    supportsSpatial: true,
  },
  {
    id: "complex-negatives",
    name: "Complex Filtering",
    description: "Combine positive and negative constraints for precise results",
    example: "Style like image 1 with colors from image 2, but NOT metallic, NOT too formal, and pattern only on collar",
    category: "negative_filtering",
    difficulty: "advanced",
    recommendedImages: 2,
    supportsNegatives: true,
    supportsSpatial: true,
  },
  {
    id: "style-fusion-three-way",
    name: "Three-Way Style Fusion",
    description: "Blend stylistic elements from three different sources",
    example: "Combine the elegance of image 1, the casualness of image 2, and the color palette of image 3",
    category: "style_fusion",
    difficulty: "advanced",
    recommendedImages: 3,
    supportsNegatives: false,
    supportsSpatial: false,
  },
];

// ============================================================================
// Prompt Suggestions
// ============================================================================

export const PROMPT_SUGGESTIONS: Record<string, PromptSuggestion> = {
  color: {
    aspect: "Color",
    examplePhrases: [
      "in {color} color",
      "with {color} tones",
      "using the color palette from image {n}",
      "in neutral colors",
      "in earth tones",
      "in pastel shades",
    ],
    negativeExamples: [
      "NOT too bright",
      "NOT neon colors",
      "NOT metallic",
      "without {color}",
    ],
  },
  style: {
    aspect: "Style/Aesthetic",
    examplePhrases: [
      "with the style from image {n}",
      "in a {style} aesthetic",
      "more {style}",
      "casual style",
      "elegant look",
      "vintage vibes",
      "modern minimal",
    ],
    negativeExamples: [
      "NOT too formal",
      "NOT too casual",
      "without vintage elements",
      "NOT streetwear",
    ],
  },
  texture: {
    aspect: "Texture/Surface",
    examplePhrases: [
      "with the texture from image {n}",
      "smooth texture",
      "ribbed knit",
      "similar surface feel",
      "with texture like {item}",
    ],
    negativeExamples: [
      "NOT too rough",
      "NOT shiny",
      "NOT glossy",
      "without sequins",
    ],
  },
  material: {
    aspect: "Material/Fabric",
    examplePhrases: [
      "in {material} material",
      "made of {fabric}",
      "cotton blend",
      "leather accent",
      "denim fabric",
      "silk finish",
    ],
    negativeExamples: [
      "NOT synthetic",
      "NOT polyester",
      "without leather",
      "NO fur",
    ],
  },
  pattern: {
    aspect: "Pattern/Print",
    examplePhrases: [
      "with the pattern from image {n}",
      "{pattern} print",
      "floral design",
      "striped pattern",
      "solid color",
      "geometric shapes",
    ],
    negativeExamples: [
      "NOT too busy",
      "NOT with animal print",
      "without polka dots",
      "NO bold patterns",
    ],
  },
  spatial: {
    aspect: "Spatial Details",
    examplePhrases: [
      "pattern on the {location}",
      "details on the {part}",
      "embroidery on collar",
      "stripes on sleeves",
      "solid color body",
      "{detail} at the hem",
    ],
    negativeExamples: [
      "NOT on the {location}",
      "without details on {part}",
      "plain {location}",
    ],
  },
  formality: {
    aspect: "Formality Level",
    examplePhrases: [
      "more formal",
      "casual everyday",
      "office appropriate",
      "evening wear",
      "weekend casual",
    ],
    negativeExamples: [
      "NOT too dressy",
      "NOT business formal",
      "NOT clubwear",
      "less formal",
    ],
  },
  fit: {
    aspect: "Fit/Silhouette",
    examplePhrases: [
      "similar fit to image {n}",
      "loose fit",
      "fitted silhouette",
      "oversized style",
      "tailored cut",
    ],
    negativeExamples: [
      "NOT too tight",
      "NOT baggy",
      "NOT cropped",
      "without oversized fit",
    ],
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: PromptCategory): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Get templates by difficulty
 */
export function getTemplatesByDifficulty(
  difficulty: "beginner" | "intermediate" | "advanced"
): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => t.difficulty === difficulty);
}

/**
 * Get templates that support specific features
 */
export function getTemplatesWithFeatures(options: {
  supportsNegatives?: boolean;
  supportsSpatial?: boolean;
  minImages?: number;
  maxImages?: number;
}): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => {
    if (options.supportsNegatives !== undefined && t.supportsNegatives !== options.supportsNegatives) {
      return false;
    }
    if (options.supportsSpatial !== undefined && t.supportsSpatial !== options.supportsSpatial) {
      return false;
    }
    if (options.minImages !== undefined && t.recommendedImages < options.minImages) {
      return false;
    }
    if (options.maxImages !== undefined && t.recommendedImages > options.maxImages) {
      return false;
    }
    return true;
  });
}

/**
 * Parse a user prompt to extract structure
 * Basic implementation - can be enhanced with NLP
 */
export function parsePromptStructure(prompt: string): ParsedPromptStructure {
  const lowercased = prompt.toLowerCase();

  // Detect negatives
  const negatives: string[] = [];
  const negativePatterns = [
    /not\s+(?:too\s+)?(\w+(?:\s+\w+)?)/gi,
    /without\s+(\w+(?:\s+\w+)?)/gi,
    /no\s+(\w+(?:\s+\w+)?)/gi,
  ];
  for (const pattern of negativePatterns) {
    const matches = lowercased.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) negatives.push(match[1]);
    }
  }

  // Detect spatial relations
  const spatialRelations: Array<{ attribute: string; location: string }> = [];
  const spatialPattern = /(\w+(?:\s+\w+)?)\s+(?:on|at)\s+(?:the\s+)?(\w+)/gi;
  const spatialMatches = lowercased.matchAll(spatialPattern);
  for (const match of spatialMatches) {
    if (match[1] && match[2]) {
      spatialRelations.push({ attribute: match[1], location: match[2] });
    }
  }

  // Detect attributes
  const attributes: string[] = [];
  const attributeKeywords = ["color", "style", "texture", "material", "pattern", "fabric", "fit", "silhouette"];
  for (const keyword of attributeKeywords) {
    if (lowercased.includes(keyword)) {
      attributes.push(keyword);
    }
  }

  // Detect colors
  const colors: string[] = [];
  const colorPatterns = [
    /\b(red|blue|green|yellow|orange|purple|pink|black|white|gray|grey|brown|beige|navy|burgundy|teal|turquoise|coral|olive|gold|silver)\b/gi,
  ];
  for (const pattern of colorPatterns) {
    const matches = lowercased.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && !colors.includes(match[1])) {
        colors.push(match[1]);
      }
    }
  }

  // Detect styles
  const styles: string[] = [];
  const styleKeywords = [
    "casual",
    "formal",
    "elegant",
    "vintage",
    "modern",
    "minimalist",
    "bohemian",
    "classic",
    "streetwear",
    "preppy",
  ];
  for (const keyword of styleKeywords) {
    if (lowercased.includes(keyword)) {
      styles.push(keyword);
    }
  }

  // Detect materials
  const materials: string[] = [];
  const materialKeywords = [
    "cotton",
    "silk",
    "wool",
    "leather",
    "denim",
    "linen",
    "polyester",
    "velvet",
    "satin",
    "chiffon",
  ];
  for (const keyword of materialKeywords) {
    if (lowercased.includes(keyword)) {
      materials.push(keyword);
    }
  }

  return {
    attributes,
    negatives,
    spatialRelations,
    colors,
    styles,
    materials,
  };
}

/**
 * Suggest improvements to a user's prompt
 */
export function suggestPromptImprovements(prompt: string): string[] {
  const suggestions: string[] = [];
  const structure = parsePromptStructure(prompt);

  if (structure.attributes.length === 0) {
    suggestions.push("Try specifying which attributes you want (color, style, texture, pattern, material)");
    suggestions.push('Example: "I want the COLOR from image 1 and the STYLE from image 2"');
  }

  if (prompt.length < 15) {
    suggestions.push("Add more details to get better results");
    suggestions.push('Example: "casual blue top" → "casual blue top with the texture from image 1"');
  }

  if (!prompt.match(/image\s+\d/i) && prompt.split(" ").length > 5) {
    suggestions.push("Reference specific images for better attribute mixing");
    suggestions.push('Example: "modern style" → "modern style from image 2"');
  }

  if (structure.negatives.length === 0 && prompt.includes("but")) {
    suggestions.push("Use 'NOT' or 'without' to exclude unwanted attributes");
    suggestions.push('Example: "...but NOT too shiny" or "...without ruffles"');
  }

  return suggestions;
}

/**
 * Get a recommended template based on prompt characteristics
 */
export function recommendTemplate(promptContext: {
  numImages: number;
  userLevel?: "beginner" | "intermediate" | "advanced";
  needsNegatives?: boolean;
  needsSpatial?: boolean;
}): PromptTemplate[] {
  const { numImages, userLevel = "beginner", needsNegatives = false, needsSpatial = false } = promptContext;

  const filtered = PROMPT_TEMPLATES.filter((t) => {
    // Match image count (allow +/- 1)
    if (Math.abs(t.recommendedImages - numImages) > 1) return false;
    // Match difficulty
    if (userLevel === "beginner" && t.difficulty === "advanced") return false;
    // Match feature requirements
    if (needsNegatives && !t.supportsNegatives) return false;
    if (needsSpatial && !t.supportsSpatial) return false;
    return true;
  });

  // Sort by difficulty (easier first) and exact image count match
  return filtered.sort((a, b) => {
    const difficultyOrder = { beginner: 0, intermediate: 1, advanced: 2 };
    if (difficultyOrder[a.difficulty] !== difficultyOrder[b.difficulty]) {
      return difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
    }
    // Prefer exact image count match
    const aDiff = Math.abs(a.recommendedImages - numImages);
    const bDiff = Math.abs(b.recommendedImages - numImages);
    return aDiff - bDiff;
  });
}
