"use strict";
/**
 * Bilingual Fashion Dictionary (Lebanon-Ready)
 *
 * Comprehensive dictionary for Arabic/English/Arabizi fashion terms.
 * Used for:
 * - Quality signal extraction from product text
 * - Red flag detection (risky marketing)
 * - Attribute normalization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DICTIONARY_VERSION = exports.RETURN_POLICY_KEYWORDS = exports.SIZE_ARABIC_PATTERNS = exports.SIZE_PATTERNS = exports.RED_FLAGS = exports.CARE_INSTRUCTIONS = exports.OCCASIONS = exports.FITS = exports.FABRICS = void 0;
exports.buildLookupMaps = buildLookupMaps;
exports.FABRICS = [
    // Premium
    {
        canonical: "silk",
        english: ["silk", "silky", "satin silk", "mulberry silk", "raw silk"],
        arabic: ["حرير", "ستان حرير", "حرير طبيعي"],
        arabizi: ["7arir", "harir", "satin harir"],
        quality_tier: "premium"
    },
    {
        canonical: "cashmere",
        english: ["cashmere", "kashmir", "cashmere blend", "pure cashmere"],
        arabic: ["كشمير", "كاشمير"],
        arabizi: ["cashmere", "kashmir"],
        quality_tier: "premium"
    },
    {
        canonical: "leather",
        english: ["leather", "genuine leather", "real leather", "full grain leather", "nappa leather", "lambskin"],
        arabic: ["جلد", "جلد طبيعي", "جلد حقيقي", "جلد غنم"],
        arabizi: ["jeld", "jild", "geld", "jeld tabi3i"],
        quality_tier: "premium"
    },
    {
        canonical: "wool",
        english: ["wool", "merino wool", "virgin wool", "lambswool", "woolblend"],
        arabic: ["صوف", "صوف ميرينو", "صوف خالص"],
        arabizi: ["suf", "souf", "wool"],
        quality_tier: "premium"
    },
    {
        canonical: "linen",
        english: ["linen", "pure linen", "irish linen", "belgian linen", "linen blend"],
        arabic: ["كتان", "كتان طبيعي"],
        arabizi: ["kattan", "ketan", "linen"],
        quality_tier: "premium"
    },
    // Standard
    {
        canonical: "cotton",
        english: ["cotton", "100% cotton", "pure cotton", "organic cotton", "egyptian cotton", "pima cotton", "supima"],
        arabic: ["قطن", "قطن خالص", "قطن مصري"],
        arabizi: ["2oton", "qoton", "cotton", "koton"],
        quality_tier: "standard"
    },
    {
        canonical: "denim",
        english: ["denim", "jeans", "raw denim", "stretch denim", "selvedge denim"],
        arabic: ["جينز", "دنيم"],
        arabizi: ["jeans", "jinez", "denim"],
        quality_tier: "standard"
    },
    {
        canonical: "satin",
        english: ["satin", "duchess satin", "charmeuse"],
        arabic: ["ساتان", "ستان"],
        arabizi: ["satin", "satan"],
        quality_tier: "standard"
    },
    {
        canonical: "velvet",
        english: ["velvet", "crushed velvet", "velour"],
        arabic: ["مخمل", "قطيفة"],
        arabizi: ["makhmal", "velvit", "velvet"],
        quality_tier: "standard"
    },
    {
        canonical: "chiffon",
        english: ["chiffon", "georgette"],
        arabic: ["شيفون", "جورجيت"],
        arabizi: ["chiffon", "shifon"],
        quality_tier: "standard"
    },
    {
        canonical: "jersey",
        english: ["jersey", "jersey knit"],
        arabic: ["جيرسي", "جرزيه"],
        arabizi: ["jersey", "jersi"],
        quality_tier: "standard"
    },
    {
        canonical: "tweed",
        english: ["tweed", "harris tweed"],
        arabic: ["تويد"],
        arabizi: ["tweed", "twid"],
        quality_tier: "standard"
    },
    // Budget
    {
        canonical: "polyester",
        english: ["polyester", "poly", "100% polyester"],
        arabic: ["بوليستر", "بولي"],
        arabizi: ["polyester", "polyster"],
        quality_tier: "budget"
    },
    {
        canonical: "nylon",
        english: ["nylon", "polyamide"],
        arabic: ["نايلون"],
        arabizi: ["nylon", "naylon"],
        quality_tier: "budget"
    },
    {
        canonical: "acrylic",
        english: ["acrylic", "acryllic"],
        arabic: ["اكريليك"],
        arabizi: ["acrylic", "akrilik"],
        quality_tier: "budget"
    },
    {
        canonical: "viscose",
        english: ["viscose", "rayon", "modal"],
        arabic: ["فسكوز", "رايون"],
        arabizi: ["viscose", "rayon"],
        quality_tier: "budget"
    },
    {
        canonical: "spandex",
        english: ["spandex", "elastane", "lycra", "stretch"],
        arabic: ["سباندكس", "ليكرا"],
        arabizi: ["spandex", "lycra", "likra"],
        quality_tier: "budget"
    },
    {
        canonical: "synthetic",
        english: ["synthetic", "man-made", "artificial"],
        arabic: ["صناعي", "اصطناعي"],
        arabizi: ["synthetic", "sina3i"],
        quality_tier: "budget"
    },
    {
        canonical: "faux_leather",
        english: ["faux leather", "pu leather", "vegan leather", "pleather", "synthetic leather", "leatherette"],
        arabic: ["جلد صناعي", "جلد اصطناعي"],
        arabizi: ["faux leather", "jeld sina3i"],
        quality_tier: "budget"
    },
];
exports.FITS = [
    {
        canonical: "slim",
        english: ["slim", "slim fit", "slim-fit", "fitted", "tailored", "skinny"],
        arabic: ["سليم", "ضيق", "سكيني"],
        arabizi: ["slim", "skinny", "fitted"]
    },
    {
        canonical: "regular",
        english: ["regular", "regular fit", "standard", "classic fit", "classic", "straight"],
        arabic: ["عادي", "قياسي", "كلاسيك"],
        arabizi: ["regular", "3adi", "classic"]
    },
    {
        canonical: "relaxed",
        english: ["relaxed", "relaxed fit", "comfort fit", "easy fit", "loose"],
        arabic: ["مريح", "واسع"],
        arabizi: ["relaxed", "mre7", "wase3"]
    },
    {
        canonical: "oversized",
        english: ["oversized", "oversize", "baggy", "boxy", "extra loose"],
        arabic: ["اوفرسايز", "واسع جدا"],
        arabizi: ["oversized", "oversize", "baggy"]
    },
    {
        canonical: "cropped",
        english: ["cropped", "crop", "short length", "ankle length"],
        arabic: ["قصير", "كروب"],
        arabizi: ["cropped", "crop", "2asir"]
    },
    {
        canonical: "wide",
        english: ["wide", "wide leg", "wide-leg", "palazzo", "flared"],
        arabic: ["واسع", "بلازو"],
        arabizi: ["wide", "wase3", "palazzo"]
    },
    {
        canonical: "high_waist",
        english: ["high waist", "high-waist", "high rise", "high-rise"],
        arabic: ["خصر عالي", "هاي ويست"],
        arabizi: ["high waist", "khasr 3ali"]
    },
    {
        canonical: "low_waist",
        english: ["low waist", "low-waist", "low rise", "low-rise", "hip hugger"],
        arabic: ["خصر واطي"],
        arabizi: ["low waist", "khasr wati"]
    },
    {
        canonical: "mid_waist",
        english: ["mid waist", "mid-waist", "mid rise", "mid-rise", "regular rise"],
        arabic: ["خصر متوسط"],
        arabizi: ["mid waist"]
    },
];
exports.OCCASIONS = [
    {
        canonical: "formal",
        english: ["formal", "formal wear", "evening", "black tie", "gala", "ball"],
        arabic: ["رسمي", "سهرة", "مناسبات"],
        arabizi: ["rasmi", "formal", "sohra", "sohre"],
        formality: "formal"
    },
    {
        canonical: "wedding",
        english: ["wedding", "bridal", "bridesmaid", "engagement", "wedding guest"],
        arabic: ["عرس", "زفاف", "عروس", "خطوبة"],
        arabizi: ["3ors", "3arous", "wedding", "zafaf"],
        formality: "formal"
    },
    {
        canonical: "business",
        english: ["business", "office", "work", "professional", "corporate"],
        arabic: ["عمل", "مكتب", "رسمي"],
        arabizi: ["business", "3amal", "maktab"],
        formality: "semi-formal"
    },
    {
        canonical: "party",
        english: ["party", "club", "night out", "cocktail", "date night"],
        arabic: ["حفلة", "سهره", "كوكتيل"],
        arabizi: ["party", "7afle", "sohra"],
        formality: "semi-formal"
    },
    {
        canonical: "casual",
        english: ["casual", "everyday", "daily", "weekend", "day-to-day", "street"],
        arabic: ["كاجوال", "يومي", "عادي"],
        arabizi: ["casual", "kajwal", "yawmi"],
        formality: "casual"
    },
    {
        canonical: "beach",
        english: ["beach", "beachwear", "resort", "vacation", "holiday", "summer"],
        arabic: ["بحر", "صيف", "عطلة"],
        arabizi: ["beach", "ba7r", "sayf"],
        formality: "casual"
    },
    {
        canonical: "sport",
        english: ["sport", "sports", "athletic", "activewear", "gym", "workout", "fitness", "running", "yoga", "training"],
        arabic: ["رياضي", "رياضة", "جيم", "تمرين"],
        arabizi: ["riyadi", "sport", "gym", "tamrin"],
        formality: "active"
    },
    {
        canonical: "lounge",
        english: ["lounge", "loungewear", "sleepwear", "pajama", "homewear", "cozy"],
        arabic: ["بيتي", "بجامة", "نوم"],
        arabizi: ["bayti", "pajama", "lounge"],
        formality: "casual"
    },
];
exports.CARE_INSTRUCTIONS = [
    {
        canonical: "machine_wash",
        english: ["machine wash", "machine washable", "washer safe", "wash machine"],
        arabic: ["غسيل آلة", "غسيل الة", "غسالة"],
        arabizi: ["machine wash", "ghassale"]
    },
    {
        canonical: "hand_wash",
        english: ["hand wash", "hand wash only", "gentle hand wash", "wash by hand"],
        arabic: ["غسيل يدوي", "غسيل باليد"],
        arabizi: ["hand wash", "ghasil yadawi"]
    },
    {
        canonical: "dry_clean",
        english: ["dry clean", "dry clean only", "professional clean", "dryclean"],
        arabic: ["تنظيف جاف", "دراي كلين"],
        arabizi: ["dry clean", "tantheef jaf"]
    },
    {
        canonical: "do_not_bleach",
        english: ["do not bleach", "no bleach", "non-chlorine bleach"],
        arabic: ["لا تبيض", "بدون كلور"],
        arabizi: ["no bleach", "la tabyed"]
    },
    {
        canonical: "tumble_dry_low",
        english: ["tumble dry low", "low heat dry", "air dry", "line dry", "flat dry"],
        arabic: ["تجفيف بارد", "تجفيف هوائي"],
        arabizi: ["tumble dry", "tajfif bared"]
    },
    {
        canonical: "iron_low",
        english: ["iron low", "low heat iron", "cool iron", "steam iron"],
        arabic: ["كوي بحرارة منخفضة", "كوي بارد"],
        arabizi: ["iron low", "kawi bared"]
    },
    {
        canonical: "do_not_iron",
        english: ["do not iron", "no iron", "non-iron"],
        arabic: ["لا تكوي", "بدون كوي"],
        arabizi: ["no iron", "la takwi"]
    },
];
exports.RED_FLAGS = [
    // High severity - strong indicators of counterfeit/low quality
    {
        terms: ["high copy", "hi copy", "1:1 copy", "aaa quality", "aaa grade", "triple a"],
        severity: "high",
        reason: "explicit_counterfeit_language"
    },
    {
        terms: ["same as original", "like original", "replica", "inspired by", "dupe", "super fake"],
        severity: "high",
        reason: "counterfeit_indication"
    },
    {
        terms: ["نسخة طبق الاصل", "نسخة اصلية", "مثل الاصلي", "هاي كوبي", "ريبليكا"],
        severity: "high",
        reason: "arabic_counterfeit_language"
    },
    // Medium severity - vague quality claims with no details
    {
        terms: ["premium quality", "best quality", "top quality", "high quality", "excellent quality", "superior quality"],
        severity: "medium",
        reason: "vague_quality_claim"
    },
    {
        terms: ["جودة عالية", "جودة ممتازة", "افضل جودة", "كواليتي"],
        severity: "medium",
        reason: "arabic_vague_quality"
    },
    {
        terms: ["luxury", "luxurious", "designer", "branded"],
        severity: "medium",
        reason: "unsubstantiated_luxury_claim"
    },
    {
        terms: ["limited time", "limited offer", "hurry", "last pieces", "selling fast", "almost gone"],
        severity: "medium",
        reason: "pressure_tactics"
    },
    // Low severity - common marketing but worth noting
    {
        terms: ["hottest", "trending", "viral", "tiktok famous", "instagram famous"],
        severity: "low",
        reason: "social_media_hype"
    },
    {
        terms: ["must have", "essential", "wardrobe staple", "game changer"],
        severity: "low",
        reason: "marketing_hyperbole"
    },
];
// ============================================================================
// Size Indicators
// ============================================================================
exports.SIZE_PATTERNS = [
    // Standard sizes
    /\b(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)\b/i,
    // Numeric sizes
    /\b(size\s*)?(\d{1,2})\b/i,
    // EU sizes
    /\b(EU|EUR)\s*(\d{2})\b/i,
    // US sizes
    /\b(US)\s*(\d{1,2})\b/i,
    // UK sizes
    /\b(UK)\s*(\d{1,2})\b/i,
    // Measurements
    /\d+\s*(cm|inch|in|"|mm)\b/i,
    // Waist/chest measurements
    /\b(waist|chest|bust|hip|length|width)\s*:?\s*\d+/i,
    // Size chart mention
    /size\s*(chart|guide|table)/i,
];
exports.SIZE_ARABIC_PATTERNS = [
    /\bمقاس\s*\d+/,
    /\bقياس\s*\d+/,
    /\bحجم\s*(صغير|متوسط|كبير)/,
];
// ============================================================================
// Return Policy Keywords
// ============================================================================
exports.RETURN_POLICY_KEYWORDS = {
    english: [
        "return", "returns", "refund", "exchange", "money back",
        "free returns", "return policy", "return within", "returnable",
        "no return", "final sale", "non-returnable", "all sales final"
    ],
    arabic: [
        "استرجاع", "استبدال", "ارجاع", "تبديل", "استرداد",
        "سياسة الارجاع", "لا يسترجع", "لا يستبدل"
    ],
    arabizi: [
        "return", "refund", "istirja3", "tabdil"
    ]
};
let _lookupMaps = null;
function buildLookupMaps() {
    if (_lookupMaps)
        return _lookupMaps;
    const fabricMap = new Map();
    for (const fabric of exports.FABRICS) {
        const entry = { canonical: fabric.canonical, quality_tier: fabric.quality_tier };
        for (const term of [...fabric.english, ...fabric.arabic, ...fabric.arabizi]) {
            fabricMap.set(term.toLowerCase(), entry);
        }
    }
    const fitMap = new Map();
    for (const fit of exports.FITS) {
        for (const term of [...fit.english, ...fit.arabic, ...fit.arabizi]) {
            fitMap.set(term.toLowerCase(), fit.canonical);
        }
    }
    const occasionMap = new Map();
    for (const occasion of exports.OCCASIONS) {
        const entry = { canonical: occasion.canonical, formality: occasion.formality };
        for (const term of [...occasion.english, ...occasion.arabic, ...occasion.arabizi]) {
            occasionMap.set(term.toLowerCase(), entry);
        }
    }
    const careMap = new Map();
    for (const care of exports.CARE_INSTRUCTIONS) {
        for (const term of [...care.english, ...care.arabic, ...care.arabizi]) {
            careMap.set(term.toLowerCase(), care.canonical);
        }
    }
    const redFlagMap = new Map();
    for (const flag of exports.RED_FLAGS) {
        const entry = { severity: flag.severity, reason: flag.reason };
        for (const term of flag.terms) {
            redFlagMap.set(term.toLowerCase(), entry);
        }
    }
    _lookupMaps = { fabricMap, fitMap, occasionMap, careMap, redFlagMap };
    return _lookupMaps;
}
/**
 * Get dictionary version for cache invalidation
 */
exports.DICTIONARY_VERSION = "1.0.0";
