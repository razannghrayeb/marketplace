/**
 * Outfit Module Exports
 * 
 * Complete My Style - Fashion outfit recommendation engine.
 */

export {
  // Main functions
  completeMyStyle,
  completeOutfitFromProductId,
  getProductForOutfit,
  
  // Detection functions
  detectCategory,
  detectColor,
  buildStyleProfile,
  
  // Color utilities
  getColorHarmonies,
  getComplementaryColors,
  getAnalogousColors,
  
  // Constants
  CATEGORY_KEYWORDS,
  CATEGORY_PAIRINGS,
  COLOR_WHEEL,
  
  // Types
  type Product,
  type StyleRecommendation,
  type RecommendedProduct,
  type OutfitCompletion,
  type ProductCategory,
  type StyleProfile,
  type ColorProfile,
  type ColorHarmony,
} from "./completestyle";
