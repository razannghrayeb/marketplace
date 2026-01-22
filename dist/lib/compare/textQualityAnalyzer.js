"use strict";
/**
 * Text Quality Analyzer
 *
 * Analyzes product title + description + return policy for quality scoring.
 * Extracts structured attributes and computes confidence scores.
 *
 * Lebanon-realistic scoring:
 * - Many vendors have minimal descriptions
 * - Arabic/Arabizi text is common
 * - Focus on actionable signals, not perfection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.analyzeTextQuality = analyzeTextQuality;
exports.analyzeTextQualityBatch = analyzeTextQualityBatch;
exports.getQualityLabel = getQualityLabel;
exports.getQualityReasons = getQualityReasons;
const fashionDictionary_1 = require("./fashionDictionary");
const arabizi_1 = require("../queryProcessor/arabizi");
// ============================================================================
// Text Normalization
// ============================================================================
/**
 * Normalize text for analysis
 * - Lowercase
 * - Normalize Arabic
 * - Remove excessive punctuation
 * - Collapse whitespace
 */
function normalizeText(text) {
    if (!text)
        return "";
    let normalized = text.toLowerCase().trim();
    // Normalize Arabic if present
    if (/[\u0600-\u06FF]/.test(normalized)) {
        normalized = (0, arabizi_1.normalizeArabic)(normalized);
    }
    // Remove excessive punctuation (keep periods, commas for readability)
    normalized = normalized.replace(/[^\w\s\u0600-\u06FF.,%-]/g, " ");
    // Collapse whitespace
    normalized = normalized.replace(/\s+/g, " ").trim();
    return normalized;
}
/**
 * Split text into words (handles Arabic and English)
 */
function getWords(text) {
    return text.split(/\s+/).filter(w => w.length > 0);
}
/**
 * Count meaningful words (excludes very short words)
 */
function countMeaningfulWords(text) {
    return getWords(text).filter(w => w.length > 2).length;
}
// ============================================================================
// Attribute Extraction
// ============================================================================
/**
 * Extract fabrics from text using dictionary
 */
function extractFabrics(text, maps) {
    const normalized = normalizeText(text);
    const found = new Set();
    const tiers = [];
    // Check multi-word phrases first (longest match)
    for (const [term, entry] of maps.fabricMap) {
        if (normalized.includes(term)) {
            found.add(entry.canonical);
            tiers.push(entry.quality_tier);
        }
    }
    // Determine overall quality tier (highest found)
    let quality_tier;
    if (tiers.includes("premium"))
        quality_tier = "premium";
    else if (tiers.includes("standard"))
        quality_tier = "standard";
    else if (tiers.includes("budget"))
        quality_tier = "budget";
    return { fabrics: Array.from(found), quality_tier };
}
/**
 * Extract fits from text
 */
function extractFits(text, maps) {
    const normalized = normalizeText(text);
    const found = new Set();
    for (const [term, canonical] of maps.fitMap) {
        if (normalized.includes(term)) {
            found.add(canonical);
        }
    }
    return Array.from(found);
}
/**
 * Extract occasions from text
 */
function extractOccasions(text, maps) {
    const normalized = normalizeText(text);
    const found = new Set();
    for (const [term, entry] of maps.occasionMap) {
        if (normalized.includes(term)) {
            found.add(entry.canonical);
        }
    }
    return Array.from(found);
}
/**
 * Extract care instructions from text
 */
function extractCare(text, maps) {
    const normalized = normalizeText(text);
    const found = new Set();
    for (const [term, canonical] of maps.careMap) {
        if (normalized.includes(term)) {
            found.add(canonical);
        }
    }
    return Array.from(found);
}
/**
 * Check for size information
 */
function hasSizeInfo(text) {
    // Check English patterns
    for (const pattern of fashionDictionary_1.SIZE_PATTERNS) {
        if (pattern.test(text))
            return true;
    }
    // Check Arabic patterns
    for (const pattern of fashionDictionary_1.SIZE_ARABIC_PATTERNS) {
        if (pattern.test(text))
            return true;
    }
    return false;
}
/**
 * Check for measurements (cm, inches, etc.)
 */
function hasMeasurements(text) {
    const measurementPattern = /\d+\s*(cm|inch|in|"|mm|سم)/i;
    return measurementPattern.test(text);
}
/**
 * Check for return policy mention
 */
function hasReturnPolicy(text) {
    const normalized = normalizeText(text);
    const allKeywords = [
        ...fashionDictionary_1.RETURN_POLICY_KEYWORDS.english,
        ...fashionDictionary_1.RETURN_POLICY_KEYWORDS.arabic,
        ...fashionDictionary_1.RETURN_POLICY_KEYWORDS.arabizi,
    ];
    return allKeywords.some(keyword => normalized.includes(keyword.toLowerCase()));
}
/**
 * Detect red flags in text
 */
function detectRedFlags(text, maps) {
    const normalized = normalizeText(text);
    const found = [];
    for (const [term, entry] of maps.redFlagMap) {
        if (normalized.includes(term)) {
            found.push({
                term,
                severity: entry.severity,
                reason: entry.reason,
            });
        }
    }
    // Check for vague quality claims without substance
    const vagueQualityClaims = [
        "premium quality", "best quality", "top quality", "high quality",
        "جودة عالية", "جودة ممتازة"
    ];
    const hasFabricMention = maps.fabricMap.size > 0 &&
        Array.from(maps.fabricMap.keys()).some(term => normalized.includes(term));
    if (!hasFabricMention) {
        for (const claim of vagueQualityClaims) {
            if (normalized.includes(claim.toLowerCase()) && !found.some(f => f.term === claim)) {
                found.push({
                    term: claim,
                    severity: "medium",
                    reason: "quality_claim_without_fabric",
                });
            }
        }
    }
    return found;
}
/**
 * Check if text is mostly emojis
 */
function isEmojiOnly(text) {
    // Remove emojis
    const withoutEmojis = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");
    const meaningfulChars = withoutEmojis.replace(/\s/g, "").length;
    const totalChars = text.replace(/\s/g, "").length;
    // If less than 30% is actual text, it's mostly emojis
    return totalChars > 0 && meaningfulChars / totalChars < 0.3;
}
const DEFAULT_WEIGHTS = {
    fabric: 20, // Having fabric mentioned is important
    fit: 10, // Fit information is helpful
    size: 15, // Size info is crucial for fashion
    care: 10, // Care instructions show quality
    returnPolicy: 15, // Return policy is trust signal
    measurements: 10, // Measurements help sizing
    wordCount: 10, // Adequate description length
    redFlagHigh: -30, // High severity red flags
    redFlagMedium: -15, // Medium severity red flags
    redFlagLow: -5, // Low severity red flags
    emojiOnly: -25, // Emoji-only descriptions
    tooShort: -15, // Very short descriptions
};
/**
 * Compute quality score (0-100)
 */
function computeQualityScore(signals, redFlags, weights = DEFAULT_WEIGHTS) {
    let score = 50; // Start at neutral
    // Positive signals
    if (signals.has_fabric)
        score += weights.fabric;
    if (signals.has_fit)
        score += weights.fit;
    if (signals.has_size_info)
        score += weights.size;
    if (signals.has_care_instructions)
        score += weights.care;
    if (signals.has_return_policy)
        score += weights.returnPolicy;
    if (signals.has_measurements)
        score += weights.measurements;
    // Word count bonus (up to max)
    if (signals.word_count >= 50) {
        score += weights.wordCount;
    }
    else if (signals.word_count >= 30) {
        score += weights.wordCount * 0.5;
    }
    // Negative signals
    if (signals.is_too_short)
        score += weights.tooShort;
    if (signals.has_emoji_only)
        score += weights.emojiOnly;
    // Red flag penalties
    for (const flag of redFlags) {
        switch (flag.severity) {
            case "high":
                score += weights.redFlagHigh;
                break;
            case "medium":
                score += weights.redFlagMedium;
                break;
            case "low":
                score += weights.redFlagLow;
                break;
        }
    }
    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));
    // Determine level
    let level;
    if (score >= 70)
        level = "green";
    else if (score >= 40)
        level = "yellow";
    else
        level = "red";
    return { score: Math.round(score), level };
}
/**
 * Compute confidence score (how confident we are in our analysis)
 */
function computeConfidenceScore(signals, attributes) {
    let confidence = 50; // Start at medium
    // More attributes found = higher confidence
    const totalAttributes = attributes.fabrics.length +
        attributes.fits.length +
        attributes.occasions.length +
        attributes.care.length;
    confidence += Math.min(totalAttributes * 5, 20);
    // More text = more confident analysis
    if (signals.word_count >= 50)
        confidence += 15;
    else if (signals.word_count >= 30)
        confidence += 10;
    else if (signals.word_count >= 15)
        confidence += 5;
    else
        confidence -= 10;
    // Has specific details = higher confidence
    if (signals.has_measurements)
        confidence += 10;
    if (signals.has_size_info)
        confidence += 5;
    return Math.max(10, Math.min(100, Math.round(confidence)));
}
// ============================================================================
// Main Analysis Function
// ============================================================================
/**
 * Analyze product text quality
 *
 * @param title Product title
 * @param description Product description (optional)
 * @param returnPolicy Return policy text (optional)
 * @returns Quality analysis with scores and extracted attributes
 */
function analyzeTextQuality(title, description, returnPolicy) {
    const startTime = performance.now();
    // Combine all text for analysis
    const allText = [title, description, returnPolicy].filter(Boolean).join(" ");
    const maps = (0, fashionDictionary_1.buildLookupMaps)();
    // Extract attributes
    const { fabrics, quality_tier } = extractFabrics(allText, maps);
    const fits = extractFits(allText, maps);
    const occasions = extractOccasions(allText, maps);
    const care = extractCare(allText, maps);
    const attributes = {
        fabrics,
        fits,
        occasions,
        care,
        fabric_quality_tier: quality_tier,
    };
    // Detect red flags
    const redFlags = detectRedFlags(allText, maps);
    // Compute signals
    const wordCount = countMeaningfulWords(allText);
    const signals = {
        has_fabric: fabrics.length > 0,
        has_fit: fits.length > 0,
        has_size_info: hasSizeInfo(allText),
        has_care_instructions: care.length > 0,
        has_return_policy: hasReturnPolicy(returnPolicy || description || ""),
        has_measurements: hasMeasurements(allText),
        word_count: wordCount,
        is_too_short: wordCount < 20,
        has_vague_claims: redFlags.some(f => f.reason.includes("vague") || f.reason.includes("quality_claim")),
        has_emoji_only: isEmojiOnly(title),
    };
    // Compute scores
    const { score: quality_score, level: quality_level } = computeQualityScore(signals, redFlags);
    const confidence_score = computeConfidenceScore(signals, attributes);
    return {
        attributes,
        redFlags,
        signals,
        quality_score,
        quality_level,
        confidence_score,
        version: fashionDictionary_1.DICTIONARY_VERSION,
        processing_time_ms: performance.now() - startTime,
    };
}
/**
 * Batch analyze multiple products
 */
function analyzeTextQualityBatch(products) {
    return products.map(p => analyzeTextQuality(p.title, p.description, p.returnPolicy));
}
/**
 * Get quality level label for UI
 */
function getQualityLabel(level) {
    switch (level) {
        case "green": return "High Quality Confidence";
        case "yellow": return "Medium Quality Confidence";
        case "red": return "Lower Confidence (Limited Details)";
    }
}
/**
 * Get quality reasons for UI
 */
function getQualityReasons(analysis) {
    const reasons = [];
    // Positive reasons
    if (analysis.signals.has_fabric) {
        const tier = analysis.attributes.fabric_quality_tier;
        if (tier === "premium") {
            reasons.push(`Premium fabric: ${analysis.attributes.fabrics.join(", ")}`);
        }
        else {
            reasons.push(`Fabric specified: ${analysis.attributes.fabrics.join(", ")}`);
        }
    }
    if (analysis.signals.has_fit) {
        reasons.push(`Fit specified: ${analysis.attributes.fits.join(", ")}`);
    }
    if (analysis.signals.has_size_info && analysis.signals.has_measurements) {
        reasons.push("Detailed size/measurements provided");
    }
    else if (analysis.signals.has_size_info) {
        reasons.push("Size information available");
    }
    if (analysis.signals.has_care_instructions) {
        reasons.push("Care instructions included");
    }
    if (analysis.signals.has_return_policy) {
        reasons.push("Return policy mentioned");
    }
    // Negative reasons
    if (analysis.signals.is_too_short) {
        reasons.push("Description is very brief");
    }
    if (analysis.signals.has_vague_claims) {
        reasons.push("Contains vague quality claims without details");
    }
    if (analysis.redFlags.some(f => f.severity === "high")) {
        reasons.push("Contains concerning marketing language");
    }
    return reasons;
}
