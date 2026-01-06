/**
 * Arabizi Transliteration
 * 
 * Bidirectional conversion between Arabizi (Arabic written in Latin characters)
 * and Arabic script. Rule-based approach for speed and consistency.
 * 
 * Common Arabizi conventions:
 * - 2 = ء (hamza) or أ/إ
 * - 3 = ع (ain)
 * - 3' or 3a = غ (ghain)
 * - 4 = ذ (thal)
 * - 5 = خ (kha)
 * - 6 = ط (ta)
 * - 6' = ظ (za/dha)
 * - 7 = ح (ha)
 * - 8 = ق (qaf)
 * - 9 = ص (sad)
 * - 9' = ض (dad)
 */

// ============================================================================
// Character Mappings
// ============================================================================

/**
 * Arabizi → Arabic mappings (multi-char patterns first for greedy matching)
 */
const ARABIZI_TO_ARABIC: [string, string][] = [
  // Multi-character patterns (must come first)
  ["sh", "ش"],
  ["ch", "ش"],     // Alternative for ش
  ["th", "ث"],
  ["dh", "ذ"],
  ["kh", "خ"],
  ["gh", "غ"],
  ["3'", "غ"],
  ["3a", "غ"],
  ["6'", "ظ"],
  ["9'", "ض"],
  ["aa", "ا"],     // Long vowel
  ["ee", "ي"],     // Long vowel
  ["oo", "و"],     // Long vowel
  ["ou", "و"],
  ["ei", "ي"],
  ["ai", "ي"],
  ["aw", "او"],
  ["ay", "اي"],
  
  // Numbers representing Arabic letters
  ["2", "ء"],      // Hamza
  ["3", "ع"],      // Ain
  ["4", "ذ"],      // Thal (alternative)
  ["5", "خ"],      // Kha (alternative)
  ["6", "ط"],      // Ta
  ["7", "ح"],      // Ha
  ["8", "ق"],      // Qaf
  ["9", "ص"],      // Sad
  
  // Single letters
  ["a", "ا"],
  ["b", "ب"],
  ["t", "ت"],
  ["j", "ج"],
  ["g", "ج"],      // Egyptian/Gulf pronunciation
  ["h", "ه"],
  ["d", "د"],
  ["r", "ر"],
  ["z", "ز"],
  ["s", "س"],
  ["c", "ك"],      // Alternative for ك
  ["f", "ف"],
  ["q", "ق"],
  ["k", "ك"],
  ["l", "ل"],
  ["m", "م"],
  ["n", "ن"],
  ["w", "و"],
  ["y", "ي"],
  ["i", "ي"],
  ["e", "ي"],      // Short vowel, often ي in context
  ["o", "و"],
  ["u", "و"],
  ["p", "ب"],      // No p in Arabic, becomes ب
  ["v", "ف"],      // No v in Arabic, becomes ف
  
  // Common letter combinations
  ["'", "ء"],      // Apostrophe as hamza
];

/**
 * Arabic → Arabizi mappings
 */
const ARABIC_TO_ARABIZI: [string, string][] = [
  // Multi-character Arabic patterns
  ["لا", "la"],
  ["ال", "al"],
  
  // Arabic letters to Arabizi
  ["ء", "2"],
  ["آ", "2a"],
  ["أ", "2"],
  ["إ", "2"],
  ["ؤ", "2"],
  ["ئ", "2"],
  ["ا", "a"],
  ["ب", "b"],
  ["ت", "t"],
  ["ث", "th"],
  ["ج", "j"],
  ["ح", "7"],
  ["خ", "kh"],
  ["د", "d"],
  ["ذ", "dh"],
  ["ر", "r"],
  ["ز", "z"],
  ["س", "s"],
  ["ش", "sh"],
  ["ص", "9"],
  ["ض", "9'"],
  ["ط", "6"],
  ["ظ", "6'"],
  ["ع", "3"],
  ["غ", "gh"],
  ["ف", "f"],
  ["ق", "q"],
  ["ك", "k"],
  ["ل", "l"],
  ["م", "m"],
  ["ن", "n"],
  ["ه", "h"],
  ["و", "w"],
  ["ي", "y"],
  ["ى", "a"],      // Alef maksura
  ["ة", "a"],      // Ta marbuta → a at end of word
  
  // Harakat (diacritics) - usually omit
  ["َ", "a"],      // Fatha
  ["ُ", "o"],      // Damma
  ["ِ", "i"],      // Kasra
  ["ّ", ""],       // Shadda (gemination) - handle separately
  ["ْ", ""],       // Sukun
  ["ً", "an"],     // Tanwin fath
  ["ٌ", "on"],     // Tanwin damm
  ["ٍ", "in"],     // Tanwin kasr
];

/**
 * Common Arabic words with preferred Arabizi spellings
 */
const ARABIC_WORD_MAP: Map<string, string> = new Map([
  // Common fashion terms
  ["قميص", "qamees"],
  ["بنطلون", "bantalon"],
  ["فستان", "fostan"],
  ["جاكيت", "jacket"],
  ["حذاء", "hitha2"],
  ["شنطة", "shanta"],
  ["حقيبة", "haqiba"],
  ["ساعة", "sa3a"],
  ["نظارة", "na6ara"],
  
  // Colors
  ["أسود", "aswad"],
  ["أبيض", "abyad"],
  ["أحمر", "a7mar"],
  ["أزرق", "azra2"],
  ["أخضر", "akhdar"],
  ["أصفر", "asfar"],
  ["بني", "bonni"],
  ["رمادي", "ramadi"],
  ["وردي", "wardi"],
  ["برتقالي", "borto2ali"],
  
  // Gender
  ["رجالي", "rijali"],
  ["نسائي", "nisa2i"],
  ["أطفال", "atfal"],
  ["بناتي", "banati"],
  ["ولادي", "waladi"],
  
  // Materials
  ["قطن", "qoton"],
  ["جلد", "jild"],
  ["حرير", "harir"],
  ["صوف", "soof"],
  ["كتان", "kattan"],
]);

/**
 * Common Arabizi words with Arabic equivalents
 */
const ARABIZI_WORD_MAP: Map<string, string> = new Map([
  // Reverse of above + additional common spellings
  ["qamees", "قميص"],
  ["2amees", "قميص"],
  ["bantalon", "بنطلون"],
  ["bntlon", "بنطلون"],
  ["pant", "بنطلون"],
  ["pants", "بنطلون"],
  ["fostan", "فستان"],
  ["fstan", "فستان"],
  ["dress", "فستان"],
  ["jacket", "جاكيت"],
  ["jaket", "جاكيت"],
  ["shoes", "حذاء"],
  ["hitha2", "حذاء"],
  ["7itha2", "حذاء"],
  ["shanta", "شنطة"],
  ["bag", "شنطة"],
  ["sha6na", "شنطة"],
  
  // Colors
  ["aswad", "أسود"],
  ["black", "أسود"],
  ["abyad", "أبيض"],
  ["white", "أبيض"],
  ["a7mar", "أحمر"],
  ["red", "أحمر"],
  ["azra2", "أزرق"],
  ["blue", "أزرق"],
  ["akhdar", "أخضر"],
  ["green", "أخضر"],
  
  // Gender terms
  ["rijali", "رجالي"],
  ["rejali", "رجالي"],
  ["men", "رجالي"],
  ["nisa2i", "نسائي"],
  ["nisai", "نسائي"],
  ["nisaei", "نسائي"],
  ["women", "نسائي"],
  ["atfal", "أطفال"],
  ["kids", "أطفال"],
]);

// ============================================================================
// Detection Functions
// ============================================================================

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const ARABIC_NUMBERS = /[٠-٩]/;
const ARABIZI_NUMBERS = /[2-9]/;  // Numbers used in Arabizi
const LATIN_RANGE = /[a-zA-Z]/;

/**
 * Check if character is Arabic
 */
export function isArabicChar(char: string): boolean {
  return ARABIC_RANGE.test(char) || ARABIC_NUMBERS.test(char);
}

/**
 * Check if character is Latin
 */
export function isLatinChar(char: string): boolean {
  return LATIN_RANGE.test(char);
}

/**
 * Check if text contains Arabizi patterns (Latin + numbers 2-9)
 */
export function hasArabiziPattern(text: string): boolean {
  // Check for number-letter combinations typical of Arabizi
  const arabiziPatterns = [
    /[a-z][2-9]/i,      // Letter followed by Arabizi number
    /[2-9][a-z]/i,      // Number followed by letter
    /\b[a-z]*[2-9]+[a-z]*\b/i,  // Word with embedded Arabizi number
  ];
  
  return arabiziPatterns.some(pattern => pattern.test(text));
}

/**
 * Detect script type of text
 */
export function detectScript(text: string): {
  primary: "en" | "ar" | "arabizi" | "mixed";
  hasArabic: boolean;
  hasLatin: boolean;
  hasArabizi: boolean;
  arabicRatio: number;
  latinRatio: number;
} {
  let arabicCount = 0;
  let latinCount = 0;
  let totalLetters = 0;
  
  for (const char of text) {
    if (isArabicChar(char)) {
      arabicCount++;
      totalLetters++;
    } else if (isLatinChar(char)) {
      latinCount++;
      totalLetters++;
    }
  }
  
  const arabicRatio = totalLetters > 0 ? arabicCount / totalLetters : 0;
  const latinRatio = totalLetters > 0 ? latinCount / totalLetters : 0;
  const hasArabizi = hasArabiziPattern(text);
  
  let primary: "en" | "ar" | "arabizi" | "mixed";
  
  if (arabicRatio > 0.8) {
    primary = "ar";
  } else if (arabicRatio > 0.2 && latinRatio > 0.2) {
    primary = "mixed";
  } else if (hasArabizi && latinRatio > 0.5) {
    primary = "arabizi";
  } else if (latinRatio > 0.5) {
    primary = "en";
  } else {
    primary = "mixed";
  }
  
  return {
    primary,
    hasArabic: arabicCount > 0,
    hasLatin: latinCount > 0,
    hasArabizi: hasArabizi,
    arabicRatio,
    latinRatio,
  };
}

// ============================================================================
// Transliteration Functions
// ============================================================================

/**
 * Transliterate Arabizi text to Arabic
 */
export function arabiziToArabic(text: string): string {
  // First check for known words
  const words = text.toLowerCase().split(/\s+/);
  const transliteratedWords = words.map(word => {
    // Check word map first
    if (ARABIZI_WORD_MAP.has(word)) {
      return ARABIZI_WORD_MAP.get(word)!;
    }
    
    // Character-by-character transliteration
    let result = word;
    for (const [arabizi, arabic] of ARABIZI_TO_ARABIC) {
      result = result.split(arabizi).join(arabic);
    }
    return result;
  });
  
  return transliteratedWords.join(" ");
}

/**
 * Transliterate Arabic text to Arabizi
 */
export function arabicToArabizi(text: string): string {
  // First check for known words
  const words = text.split(/\s+/);
  const transliteratedWords = words.map(word => {
    // Check word map first
    if (ARABIC_WORD_MAP.has(word)) {
      return ARABIC_WORD_MAP.get(word)!;
    }
    
    // Character-by-character transliteration
    let result = word;
    for (const [arabic, arabizi] of ARABIC_TO_ARABIZI) {
      result = result.split(arabic).join(arabizi);
    }
    return result;
  });
  
  return transliteratedWords.join(" ");
}

/**
 * Normalize Arabic text (remove diacritics, normalize letters)
 */
export function normalizeArabic(text: string): string {
  return text
    // Remove Arabic diacritics
    .replace(/[\u064B-\u065F\u0670]/g, "")
    // Normalize alef variants
    .replace(/[أإآ]/g, "ا")
    // Normalize taa marbuta to haa at end
    .replace(/ة(?=\s|$)/g, "ه")
    // Normalize alef maksura to yaa
    .replace(/ى/g, "ي")
    // Remove tatweel (kashida)
    .replace(/ـ/g, "");
}

/**
 * Get all transliteration variants of a query
 * Useful for fuzzy matching
 */
export function getTransliterationVariants(text: string): string[] {
  const variants: Set<string> = new Set();
  const script = detectScript(text);
  
  variants.add(text.toLowerCase());
  
  if (script.primary === "ar" || script.hasArabic) {
    // Add Arabizi variant
    const arabiziVariant = arabicToArabizi(text);
    variants.add(arabiziVariant.toLowerCase());
    variants.add(normalizeArabic(text));
  }
  
  if (script.primary === "arabizi" || script.hasArabizi) {
    // Add Arabic variant
    const arabicVariant = arabiziToArabic(text);
    variants.add(arabicVariant);
    variants.add(normalizeArabic(arabicVariant));
  }
  
  if (script.primary === "en") {
    // Try converting as if it were Arabizi
    const arabicVariant = arabiziToArabic(text);
    if (arabicVariant !== text.toLowerCase()) {
      variants.add(arabicVariant);
    }
  }
  
  return Array.from(variants);
}

// ============================================================================
// Common Arabizi Patterns for Fashion
// ============================================================================

/**
 * Common fashion-related Arabizi terms with their meanings
 */
export const FASHION_ARABIZI: Map<string, { arabic: string; english: string; category: string }> = new Map([
  // Clothing items
  ["qamees", { arabic: "قميص", english: "shirt", category: "tops" }],
  ["2amees", { arabic: "قميص", english: "shirt", category: "tops" }],
  ["bloza", { arabic: "بلوزة", english: "blouse", category: "tops" }],
  ["bantalon", { arabic: "بنطلون", english: "pants", category: "bottoms" }],
  ["bntlon", { arabic: "بنطلون", english: "pants", category: "bottoms" }],
  ["jeans", { arabic: "جينز", english: "jeans", category: "bottoms" }],
  ["jeanz", { arabic: "جينز", english: "jeans", category: "bottoms" }],
  ["fostan", { arabic: "فستان", english: "dress", category: "dresses" }],
  ["fstan", { arabic: "فستان", english: "dress", category: "dresses" }],
  ["jaket", { arabic: "جاكيت", english: "jacket", category: "outerwear" }],
  ["jacket", { arabic: "جاكيت", english: "jacket", category: "outerwear" }],
  ["koot", { arabic: "كوت", english: "coat", category: "outerwear" }],
  ["hitha2", { arabic: "حذاء", english: "shoes", category: "footwear" }],
  ["7itha2", { arabic: "حذاء", english: "shoes", category: "footwear" }],
  ["sobbat", { arabic: "صبات", english: "sneakers", category: "footwear" }],
  ["shanta", { arabic: "شنطة", english: "bag", category: "accessories" }],
  ["sha6na", { arabic: "شنطة", english: "bag", category: "accessories" }],
  
  // Colors
  ["aswad", { arabic: "أسود", english: "black", category: "color" }],
  ["abyad", { arabic: "أبيض", english: "white", category: "color" }],
  ["a7mar", { arabic: "أحمر", english: "red", category: "color" }],
  ["azra2", { arabic: "أزرق", english: "blue", category: "color" }],
  ["akhdar", { arabic: "أخضر", english: "green", category: "color" }],
  ["a5dar", { arabic: "أخضر", english: "green", category: "color" }],
  ["asfar", { arabic: "أصفر", english: "yellow", category: "color" }],
  
  // Gender
  ["rijali", { arabic: "رجالي", english: "men", category: "gender" }],
  ["rejali", { arabic: "رجالي", english: "men", category: "gender" }],
  ["nisa2i", { arabic: "نسائي", english: "women", category: "gender" }],
  ["nisai", { arabic: "نسائي", english: "women", category: "gender" }],
  ["atfal", { arabic: "أطفال", english: "kids", category: "gender" }],
]);

/**
 * Expand Arabizi fashion term to all forms
 */
export function expandFashionTerm(term: string): {
  arabic?: string;
  english?: string;
  category?: string;
} | null {
  const normalized = term.toLowerCase().trim();
  
  if (FASHION_ARABIZI.has(normalized)) {
    return FASHION_ARABIZI.get(normalized)!;
  }
  
  // Try with common Arabizi number substitutions
  const withNumbers = normalized
    .replace(/a/g, "2")  // Sometimes 'a' is used for hamza
    .replace(/h/g, "7"); // Sometimes 'h' is used for ح
  
  if (FASHION_ARABIZI.has(withNumbers)) {
    return FASHION_ARABIZI.get(withNumbers)!;
  }
  
  return null;
}
