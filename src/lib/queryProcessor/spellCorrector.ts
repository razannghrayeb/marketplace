/**
 * Spell Corrector
 * 
 * Fast edit-distance based spell correction against dictionaries.
 * Uses Levenshtein distance with optimizations for speed.
 */

import { DictionaryEntry, Correction, ConfidenceLevel } from "./types";

// ============================================================================
// Levenshtein Distance (Optimized)
// ============================================================================

/**
 * Compute Levenshtein distance between two strings
 * Optimized with early termination and single-row DP
 */
export function levenshteinDistance(a: string, b: string, maxDistance?: number): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  // Swap to ensure a is shorter (memory optimization)
  if (a.length > b.length) {
    [a, b] = [b, a];
  }
  
  const aLen = a.length;
  const bLen = b.length;
  
  // Early termination if length difference exceeds max
  if (maxDistance !== undefined && Math.abs(aLen - bLen) > maxDistance) {
    return maxDistance + 1;
  }
  
  // Single row DP (memory optimization)
  let prevRow = new Array(aLen + 1);
  let currRow = new Array(aLen + 1);
  
  // Initialize first row
  for (let i = 0; i <= aLen; i++) {
    prevRow[i] = i;
  }
  
  for (let j = 1; j <= bLen; j++) {
    currRow[0] = j;
    let minInRow = j;
    
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i] + 1,      // Deletion
        currRow[i - 1] + 1,  // Insertion
        prevRow[i - 1] + cost // Substitution
      );
      minInRow = Math.min(minInRow, currRow[i]);
    }
    
    // Early termination if all values in row exceed max
    if (maxDistance !== undefined && minInRow > maxDistance) {
      return maxDistance + 1;
    }
    
    [prevRow, currRow] = [currRow, prevRow];
  }
  
  return prevRow[aLen];
}

/**
 * Compute Damerau-Levenshtein distance (includes transpositions)
 */
export function damerauLevenshtein(a: string, b: string, maxDistance?: number): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const aLen = a.length;
  const bLen = b.length;
  
  if (maxDistance !== undefined && Math.abs(aLen - bLen) > maxDistance) {
    return maxDistance + 1;
  }
  
  // Full matrix for Damerau-Levenshtein (needs 2 previous rows)
  const d: number[][] = [];
  for (let i = 0; i <= aLen; i++) {
    d[i] = new Array(bLen + 1);
    d[i][0] = i;
  }
  for (let j = 0; j <= bLen; j++) {
    d[0][j] = j;
  }
  
  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // Deletion
        d[i][j - 1] + 1,      // Insertion
        d[i - 1][j - 1] + cost // Substitution
      );
      
      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  
  return d[aLen][bLen];
}

// ============================================================================
// Similarity Metrics
// ============================================================================

/**
 * Calculate normalized similarity (0-1, higher is better)
 */
export function normalizedSimilarity(a: string, b: string): number {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - (distance / maxLen);
}

/**
 * Calculate Jaro-Winkler similarity (good for short strings like names)
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  
  let matches = 0;
  let transpositions = 0;
  
  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  
  if (matches === 0) return 0;
  
  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  
  // Winkler modification (boost for common prefix)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(a.length, b.length)); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ============================================================================
// Spell Correction
// ============================================================================

export interface SpellCorrection {
  original: string;
  correction: string;
  distance: number;
  similarity: number;
  confidence: number;
  source: DictionaryEntry | null;
}

/**
 * Find best correction for a word from dictionary
 */
export function findCorrection(
  word: string,
  dictionary: Map<string, DictionaryEntry>,
  maxDistance: number = 2
): SpellCorrection | null {
  const normalizedWord = word.toLowerCase().trim();
  
  if (normalizedWord.length < 2) {
    return null;  // Don't correct single characters
  }
  
  // Check exact match first
  if (dictionary.has(normalizedWord)) {
    return {
      original: word,
      correction: dictionary.get(normalizedWord)!.term,
      distance: 0,
      similarity: 1,
      confidence: 1,
      source: dictionary.get(normalizedWord)!,
    };
  }
  
  let bestMatch: SpellCorrection | null = null;
  let bestScore = 0;
  
  for (const [key, entry] of dictionary) {
    // Skip if length difference is too large
    if (Math.abs(key.length - normalizedWord.length) > maxDistance) {
      continue;
    }
    
    // Check normalized term
    const distance = damerauLevenshtein(normalizedWord, entry.normalizedTerm, maxDistance);
    
    if (distance <= maxDistance) {
      const similarity = normalizedSimilarity(normalizedWord, entry.normalizedTerm);
      
      // Score combines similarity, distance, and popularity
      const score = similarity * 0.6 + (1 - distance / maxDistance) * 0.2 + entry.popularity * 0.2;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          original: word,
          correction: entry.term,
          distance,
          similarity,
          confidence: calculateConfidence(distance, similarity, normalizedWord.length),
          source: entry,
        };
      }
    }
    
    // Also check aliases
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        const aliasNorm = alias.toLowerCase();
        const aliasDistance = damerauLevenshtein(normalizedWord, aliasNorm, maxDistance);
        
        if (aliasDistance <= maxDistance) {
          const aliasSimilarity = normalizedSimilarity(normalizedWord, aliasNorm);
          const score = aliasSimilarity * 0.6 + (1 - aliasDistance / maxDistance) * 0.2 + entry.popularity * 0.2;
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              original: word,
              correction: entry.term,
              distance: aliasDistance,
              similarity: aliasSimilarity,
              confidence: calculateConfidence(aliasDistance, aliasSimilarity, normalizedWord.length),
              source: entry,
            };
          }
        }
      }
    }
  }
  
  return bestMatch;
}

/**
 * Calculate confidence based on distance, similarity, and word length
 */
function calculateConfidence(distance: number, similarity: number, wordLength: number): number {
  // Longer words can tolerate more distance
  const lengthFactor = Math.min(1, wordLength / 6);
  const distancePenalty = distance * (1 - lengthFactor * 0.3);
  
  let confidence = similarity;
  
  // Penalize by distance
  if (distance === 0) {
    confidence = 1;
  } else if (distance === 1) {
    confidence = Math.min(0.95, similarity * 1.1);
  } else if (distance === 2) {
    confidence = Math.min(0.85, similarity);
  } else {
    confidence = Math.min(0.7, similarity * 0.9);
  }
  
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Convert confidence score to level
 */
export function confidenceToLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
}

/**
 * Find corrections for all words in a query
 */
export function correctQuery(
  query: string,
  dictionaries: {
    brands: Map<string, DictionaryEntry>;
    categories: Map<string, DictionaryEntry>;
    attributes: Map<string, DictionaryEntry>;
    commonQueries: Map<string, DictionaryEntry>;
  },
  maxDistance: number = 2
): Correction[] {
  const words = query.split(/\s+/).filter(w => w.length > 0);
  const corrections: Correction[] = [];
  
  for (const word of words) {
    // Try each dictionary in order of priority
    let bestCorrection: SpellCorrection | null = null;
    
    // Brands are highest priority (exact or near-exact matches)
    const brandCorrection = findCorrection(word, dictionaries.brands, Math.min(maxDistance, 2));
    if (brandCorrection && brandCorrection.confidence >= 0.8) {
      bestCorrection = brandCorrection;
    }
    
    // Try categories
    if (!bestCorrection) {
      const categoryCorrection = findCorrection(word, dictionaries.categories, maxDistance);
      if (categoryCorrection && categoryCorrection.confidence >= 0.7) {
        bestCorrection = categoryCorrection;
      }
    }
    
    // Try attributes (colors, materials, etc.)
    if (!bestCorrection) {
      const attrCorrection = findCorrection(word, dictionaries.attributes, maxDistance);
      if (attrCorrection && attrCorrection.confidence >= 0.7) {
        bestCorrection = attrCorrection;
      }
    }
    
    // Try common queries
    if (!bestCorrection) {
      const queryCorrection = findCorrection(word, dictionaries.commonQueries, maxDistance);
      if (queryCorrection && queryCorrection.confidence >= 0.6) {
        bestCorrection = queryCorrection;
      }
    }
    
    if (bestCorrection && bestCorrection.correction !== word) {
      corrections.push({
        original: bestCorrection.original,
        corrected: bestCorrection.correction,
        source: "spell_check",
        confidence: bestCorrection.confidence,
        confidenceLevel: confidenceToLevel(bestCorrection.confidence),
      });
    }
  }
  
  return corrections;
}

// ============================================================================
// Phonetic Matching (for brand names)
// ============================================================================

/**
 * Simple Soundex-like encoding for basic phonetic matching
 */
export function phoneticEncode(text: string): string {
  const word = text.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length === 0) return "";
  
  const firstLetter = word[0];
  
  // Map letters to codes
  const codes: Record<string, string> = {
    b: "1", f: "1", p: "1", v: "1",
    c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
    d: "3", t: "3",
    l: "4",
    m: "5", n: "5",
    r: "6",
    a: "", e: "", i: "", o: "", u: "", h: "", w: "", y: "",
  };
  
  let encoded = firstLetter;
  let prevCode = codes[firstLetter] || "";
  
  for (let i = 1; i < word.length && encoded.length < 4; i++) {
    const code = codes[word[i]] || "";
    if (code && code !== prevCode) {
      encoded += code;
    }
    prevCode = code;
  }
  
  return encoded.padEnd(4, "0");
}

/**
 * Check if two words are phonetically similar
 */
export function isPhoneticMatch(a: string, b: string): boolean {
  return phoneticEncode(a) === phoneticEncode(b);
}
