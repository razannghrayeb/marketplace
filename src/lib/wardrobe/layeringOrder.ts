/**
 * Layering Order Understanding
 *
 * Determines the correct layering order for outfit pieces.
 * Essential for:
 * - Outfit visualization (what goes on top of what)
 * - Styling recommendations (layering suggestions)
 * - Weather-appropriate outfit generation
 *
 * Uses fashion domain knowledge about how garments layer:
 * Base → Mid → Outer layers
 */

// ============================================================================
// Types
// ============================================================================

export interface LayeredPiece {
  id: number;
  category: string;
  layerLevel: number;      // 1 (base) to 5 (outermost)
  layerName: string;       // "base", "mid", "outer", "accessory", "footwear"
  zIndex: number;          // For visualization stacking
  canLayerOver: string[];  // What this can layer over
  canLayerUnder: string[]; // What can layer over this
}

export interface LayeringStructure {
  pieces: LayeredPiece[];
  layerOrder: number[];    // IDs in rendering order (innermost to outermost)
  isValid: boolean;
  issues: string[];
  suggestions: string[];
}

export type LayerCategory =
  | 'underwear'      // Layer 0
  | 'base'           // Layer 1: t-shirts, tank tops, thin tops
  | 'mid'            // Layer 2: shirts, blouses, sweaters
  | 'outer'          // Layer 3: jackets, coats, blazers
  | 'outerwear'      // Layer 4: heavy coats, parkas
  | 'accessory'      // Special: scarves, jewelry
  | 'footwear'       // Special: shoes, boots
  | 'headwear'       // Special: hats, caps
  | 'bottom';        // Special: pants, skirts (separate layer system)

// ============================================================================
// Layering Rules Database
// ============================================================================

const LAYER_RULES: Record<string, { layer: number; category: LayerCategory; canLayerOver: LayerCategory[]; canLayerUnder: LayerCategory[] }> = {
  // Base Layer (1)
  'tank top': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['mid', 'outer', 'outerwear'] },
  'cami': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['mid', 'outer', 'outerwear'] },
  't-shirt': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['mid', 'outer', 'outerwear'] },
  'tee': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['mid', 'outer', 'outerwear'] },
  'crop top': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['mid', 'outer', 'outerwear'] },

  // Mid Layer (2)
  'shirt': { layer: 2, category: 'mid', canLayerOver: ['base', 'underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'blouse': { layer: 2, category: 'mid', canLayerOver: ['base', 'underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'sweater': { layer: 2, category: 'mid', canLayerOver: ['base', 'underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'hoodie': { layer: 2, category: 'mid', canLayerOver: ['base', 'underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'sweatshirt': { layer: 2, category: 'mid', canLayerOver: ['base', 'underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'cardigan': { layer: 2, category: 'mid', canLayerOver: ['base', 'underwear'], canLayerUnder: ['outer', 'outerwear'] },

  // Outer Layer (3)
  'jacket': { layer: 3, category: 'outer', canLayerOver: ['base', 'mid', 'underwear'], canLayerUnder: ['outerwear'] },
  'blazer': { layer: 3, category: 'outer', canLayerOver: ['base', 'mid', 'underwear'], canLayerUnder: ['outerwear'] },
  'bomber': { layer: 3, category: 'outer', canLayerOver: ['base', 'mid', 'underwear'], canLayerUnder: ['outerwear'] },
  'denim jacket': { layer: 3, category: 'outer', canLayerOver: ['base', 'mid', 'underwear'], canLayerUnder: ['outerwear'] },
  'leather jacket': { layer: 3, category: 'outer', canLayerOver: ['base', 'mid', 'underwear'], canLayerUnder: ['outerwear'] },

  // Outerwear Layer (4)
  'coat': { layer: 4, category: 'outerwear', canLayerOver: ['base', 'mid', 'outer', 'underwear'], canLayerUnder: [] },
  'parka': { layer: 4, category: 'outerwear', canLayerOver: ['base', 'mid', 'outer', 'underwear'], canLayerUnder: [] },
  'trench coat': { layer: 4, category: 'outerwear', canLayerOver: ['base', 'mid', 'outer', 'underwear'], canLayerUnder: [] },
  'overcoat': { layer: 4, category: 'outerwear', canLayerOver: ['base', 'mid', 'outer', 'underwear'], canLayerUnder: [] },

  // Special: Dresses (standalone or with layers)
  'dress': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'maxi dress': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['outer', 'outerwear'] },
  'mini dress': { layer: 1, category: 'base', canLayerOver: ['underwear'], canLayerUnder: ['outer', 'outerwear'] },

  // Bottoms (separate layer system, parallel to tops)
  'pants': { layer: 1, category: 'bottom', canLayerOver: ['underwear'], canLayerUnder: [] },
  'jeans': { layer: 1, category: 'bottom', canLayerOver: ['underwear'], canLayerUnder: [] },
  'shorts': { layer: 1, category: 'bottom', canLayerOver: ['underwear'], canLayerUnder: [] },
  'skirt': { layer: 1, category: 'bottom', canLayerOver: ['underwear'], canLayerUnder: [] },
  'leggings': { layer: 1, category: 'bottom', canLayerOver: ['underwear'], canLayerUnder: [] },

  // Accessories (layer on top or special positioning)
  'scarf': { layer: 4, category: 'accessory', canLayerOver: ['base', 'mid', 'outer'], canLayerUnder: [] },
  'necklace': { layer: 4, category: 'accessory', canLayerOver: ['base', 'mid'], canLayerUnder: [] },
  'belt': { layer: 2, category: 'accessory', canLayerOver: ['base', 'mid'], canLayerUnder: [] },

  // Footwear (bottom of visualization)
  'shoes': { layer: 0, category: 'footwear', canLayerOver: [], canLayerUnder: [] },
  'sneakers': { layer: 0, category: 'footwear', canLayerOver: [], canLayerUnder: [] },
  'boots': { layer: 0, category: 'footwear', canLayerOver: [], canLayerUnder: [] },
  'heels': { layer: 0, category: 'footwear', canLayerOver: [], canLayerUnder: [] },
  'sandals': { layer: 0, category: 'footwear', canLayerOver: [], canLayerUnder: [] },

  // Headwear (top of visualization)
  'hat': { layer: 5, category: 'headwear', canLayerOver: [], canLayerUnder: [] },
  'cap': { layer: 5, category: 'headwear', canLayerOver: [], canLayerUnder: [] },
  'beanie': { layer: 5, category: 'headwear', canLayerOver: [], canLayerUnder: [] },
};

// ============================================================================
// Main Layering Functions
// ============================================================================

/**
 * Determine layering order for outfit pieces
 */
export function determineLayeringOrder(
  pieces: Array<{ id: number; category: string }>
): LayeringStructure {
  const layeredPieces: LayeredPiece[] = [];
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Analyze each piece
  for (const piece of pieces) {
    const rule = findLayeringRule(piece.category);

    if (!rule) {
      issues.push(`Unknown layering for category: ${piece.category}`);
      // Assign default layer
      layeredPieces.push({
        id: piece.id,
        category: piece.category,
        layerLevel: 2,
        layerName: 'mid',
        zIndex: 50,
        canLayerOver: [],
        canLayerUnder: [],
      });
      continue;
    }

    layeredPieces.push({
      id: piece.id,
      category: piece.category,
      layerLevel: rule.layer,
      layerName: rule.category,
      zIndex: calculateZIndex(rule.layer, rule.category),
      canLayerOver: rule.canLayerOver,
      canLayerUnder: rule.canLayerUnder,
    });
  }

  // Sort by layer level (innermost to outermost)
  layeredPieces.sort((a, b) => a.layerLevel - b.layerLevel);

  // Validate layering logic
  const validationResult = validateLayering(layeredPieces);
  issues.push(...validationResult.issues);
  suggestions.push(...validationResult.suggestions);

  // Additional suggestions
  if (!layeredPieces.some(p => p.layerName === 'base')) {
    suggestions.push('Consider adding a base layer (t-shirt, tank top)');
  }

  if (layeredPieces.filter(p => p.layerName === 'outer' || p.layerName === 'outerwear').length > 1) {
    issues.push('Multiple outer layers detected - may look bulky');
  }

  return {
    pieces: layeredPieces,
    layerOrder: layeredPieces.map(p => p.id),
    isValid: issues.length === 0,
    issues,
    suggestions,
  };
}

/**
 * Find layering rule for a category
 */
function findLayeringRule(category: string): (typeof LAYER_RULES)[string] | null {
  const normalized = category.toLowerCase().trim();

  // Direct match
  if (LAYER_RULES[normalized]) {
    return LAYER_RULES[normalized];
  }

  // Fuzzy match
  for (const [key, rule] of Object.entries(LAYER_RULES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return rule;
    }
  }

  return null;
}

/**
 * Calculate z-index for visualization stacking
 */
function calculateZIndex(layer: number, category: LayerCategory): number {
  const baseZIndex = {
    footwear: 0,
    bottom: 10,
    underwear: 20,
    base: 30,
    mid: 40,
    outer: 50,
    outerwear: 60,
    accessory: 70,
    headwear: 80,
  };

  return baseZIndex[category] || layer * 10;
}

/**
 * Validate layering logic
 */
function validateLayering(pieces: LayeredPiece[]): { issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Check for impossible layering
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const inner = pieces[i];
      const outer = pieces[j];

      // Check if outer can actually layer over inner
      if (
        !outer.canLayerOver.includes(inner.layerName as LayerCategory) &&
        outer.layerName !== inner.layerName &&
        outer.layerLevel <= inner.layerLevel
      ) {
        issues.push(
          `${outer.category} (layer ${outer.layerLevel}) may not layer properly over ${inner.category} (layer ${inner.layerLevel})`
        );
      }
    }
  }

  // Check for missing essentials
  const hasTop = pieces.some(p => ['base', 'mid'].includes(p.layerName));
  const hasBottom = pieces.some(p => p.layerName === 'bottom');

  if (!hasTop && !pieces.some(p => p.category.includes('dress'))) {
    issues.push('Outfit is missing a top');
  }

  if (!hasBottom && !pieces.some(p => p.category.includes('dress'))) {
    issues.push('Outfit is missing a bottom');
  }

  return { issues, suggestions };
}

/**
 * Suggest layering improvements
 */
export function suggestLayering(pieces: LayeredPiece[]): string[] {
  const suggestions: string[] = [];
  const layers = new Set(pieces.map(p => p.layerName));

  // Suggest a mid-layer if only base + outer
  if (layers.has('base') && layers.has('outer') && !layers.has('mid')) {
    suggestions.push('Consider adding a mid-layer (shirt, sweater) for more depth');
  }

  // Suggest outerwear for cold weather
  if (layers.has('base') || layers.has('mid')) {
    if (!layers.has('outer') && !layers.has('outerwear')) {
      suggestions.push('Add a jacket or coat for cooler weather');
    }
  }

  // Suggest accessories
  if (!layers.has('accessory')) {
    suggestions.push('Accessories like a scarf or necklace can complete the look');
  }

  // Suggest footwear if missing
  if (!layers.has('footwear')) {
    suggestions.push('Don\'t forget footwear to complete the outfit');
  }

  return suggestions;
}

/**
 * Get recommended layering for a specific weather/occasion
 */
export function getRecommendedLayers(context: {
  temperature?: number;  // Celsius
  occasion?: 'casual' | 'work' | 'formal' | 'active';
  season?: 'spring' | 'summer' | 'fall' | 'winter';
}): { recommended: LayerCategory[]; optional: LayerCategory[] } {
  const { temperature, occasion, season } = context;

  const recommended: LayerCategory[] = ['base', 'bottom', 'footwear'];
  const optional: LayerCategory[] = [];

  // Temperature-based layering
  if (temperature !== undefined) {
    if (temperature < 10) {
      // Cold weather
      recommended.push('mid', 'outer', 'outerwear');
      optional.push('accessory'); // scarf
    } else if (temperature < 20) {
      // Cool weather
      recommended.push('mid', 'outer');
      optional.push('accessory');
    } else if (temperature < 25) {
      // Mild weather
      optional.push('mid', 'outer');
    }
    // Warm weather (25+): just base layer
  }

  // Occasion-based layering
  if (occasion === 'formal' || occasion === 'work') {
    if (!recommended.includes('outer')) {
      recommended.push('outer'); // Blazer for formal/work
    }
    optional.push('accessory'); // Belt, jewelry
  }

  return { recommended, optional };
}

/**
 * Check if outfit has appropriate layering for weather
 */
export function isAppropriateForWeather(
  pieces: LayeredPiece[],
  temperature: number
): { appropriate: boolean; reason: string } {
  const layers = new Set(pieces.map(p => p.layerName));

  if (temperature < 10) {
    // Cold weather - needs outer layers
    if (!layers.has('outer') && !layers.has('outerwear')) {
      return {
        appropriate: false,
        reason: 'Too cold - add a jacket or coat',
      };
    }
  } else if (temperature > 30) {
    // Hot weather - shouldn't have heavy layers
    if (layers.has('outerwear') || layers.has('outer')) {
      return {
        appropriate: false,
        reason: 'Too hot for jackets or coats',
      };
    }
  }

  return { appropriate: true, reason: 'Appropriate layering for weather' };
}
