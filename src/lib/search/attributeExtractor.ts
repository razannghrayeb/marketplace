/**
 * Attribute Extraction Service
 * 
 * Production-grade title attribute extraction:
 * 1. Rule-based extraction (fast path) - handles ~90% of cases
 * 2. ML fallback (zero-shot) - handles edge cases
 * 3. Caching layer - prevents reprocessing
 * 
 * Extracts: color, material, fit, style, gender, size
 */

import crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface ExtractedAttributes {
  color?: string;
  colors?: string[];          // Multiple colors (e.g., "black and white")
  material?: string;
  materials?: string[];       // Multiple materials (e.g., "cotton blend")
  fit?: string;
  style?: string;
  gender?: string;
  size?: string;
  pattern?: string;
  sleeve?: string;
  neckline?: string;
}

export interface ExtractionResult {
  attributes: ExtractedAttributes;
  confidence: Record<string, number>;  // Confidence per attribute
  extractor: "rules" | "ml" | "hybrid";
  version: string;
  normalized_title: string;
  hash: string;
}

export interface ExtractionOptions {
  useML?: boolean;           // Enable ML fallback (default: true)
  mlThreshold?: number;      // Min ML confidence (default: 0.7)
  maxMLAttributes?: number;  // Max attrs to extract via ML (default: 3)
}

// Current extractor version - bump when dictionaries/logic changes
const EXTRACTOR_VERSION = "1.0.0";

// ============================================================================
// Phrase Dictionaries (longest match first ordering)
// ============================================================================

// Colors - ordered by phrase length (longest first for greedy matching)
const COLOR_PHRASES: [string, string][] = [
  // Multi-word colors first
  ["off white", "off-white"],
  ["dusty pink", "dusty-pink"],
  ["dusty rose", "dusty-rose"],
  ["baby blue", "baby-blue"],
  ["sky blue", "sky-blue"],
  ["royal blue", "royal-blue"],
  ["navy blue", "navy"],
  ["light blue", "light-blue"],
  ["dark blue", "dark-blue"],
  ["powder blue", "powder-blue"],
  ["cobalt blue", "cobalt"],
  ["midnight blue", "midnight-blue"],
  ["light grey", "light-gray"],
  ["light gray", "light-gray"],
  ["dark grey", "dark-gray"],
  ["dark gray", "dark-gray"],
  ["charcoal grey", "charcoal"],
  ["charcoal gray", "charcoal"],
  ["heather grey", "heather-gray"],
  ["heather gray", "heather-gray"],
  ["army green", "army-green"],
  ["olive green", "olive"],
  ["forest green", "forest-green"],
  ["mint green", "mint"],
  ["lime green", "lime"],
  ["hunter green", "hunter-green"],
  ["hot pink", "hot-pink"],
  ["light pink", "light-pink"],
  ["blush pink", "blush"],
  ["burnt orange", "burnt-orange"],
  ["rust orange", "rust"],
  ["wine red", "wine"],
  ["cherry red", "cherry"],
  ["burgundy red", "burgundy"],
  ["bright red", "bright-red"],
  ["dark red", "dark-red"],
  ["mustard yellow", "mustard"],
  ["pale yellow", "pale-yellow"],
  ["multi color", "multicolor"],
  ["multi colour", "multicolor"],
  ["multicolor", "multicolor"],
  ["multicolour", "multicolor"],
  // Single-word colors
  ["black", "black"],
  ["white", "white"],
  ["red", "red"],
  ["blue", "blue"],
  ["green", "green"],
  ["yellow", "yellow"],
  ["orange", "orange"],
  ["pink", "pink"],
  ["purple", "purple"],
  ["violet", "violet"],
  ["brown", "brown"],
  ["beige", "beige"],
  ["tan", "tan"],
  ["cream", "cream"],
  ["ivory", "ivory"],
  ["grey", "gray"],
  ["gray", "gray"],
  ["charcoal", "charcoal"],
  ["navy", "navy"],
  ["teal", "teal"],
  ["turquoise", "turquoise"],
  ["cyan", "cyan"],
  ["aqua", "aqua"],
  ["coral", "coral"],
  ["peach", "peach"],
  ["salmon", "salmon"],
  ["burgundy", "burgundy"],
  ["maroon", "maroon"],
  ["wine", "wine"],
  ["plum", "plum"],
  ["lavender", "lavender"],
  ["lilac", "lilac"],
  ["mauve", "mauve"],
  ["fuchsia", "fuchsia"],
  ["magenta", "magenta"],
  ["olive", "olive"],
  ["khaki", "khaki"],
  ["sage", "sage"],
  ["mint", "mint"],
  ["emerald", "emerald"],
  ["jade", "jade"],
  ["rust", "rust"],
  ["copper", "copper"],
  ["bronze", "bronze"],
  ["gold", "gold"],
  ["golden", "gold"],
  ["silver", "silver"],
  ["metallic", "metallic"],
  ["nude", "nude"],
  ["camel", "camel"],
  ["chocolate", "chocolate"],
  ["espresso", "espresso"],
  ["taupe", "taupe"],
  ["mocha", "mocha"],
  ["sand", "sand"],
  ["stone", "stone"],
  ["ash", "ash"],
  ["slate", "slate"],
  ["indigo", "indigo"],
  ["cobalt", "cobalt"],
  ["denim", "denim-blue"],  // Color context
  ["neon", "neon"],
  ["pastel", "pastel"],
  // ── Modern fashion color names ─────────────────────────────────────────
  // Many catalogs (Everlane, Madewell, Reformation, COS, etc.) use these
  // in titles like "Cropped Cable Sweater | Bone" or "Utility Jean | Icy Water".
  // Without them the title-fallback path returns no color and downstream tier
  // matching can't tell that "Bone" is white-family.
  // White / off-white family
  ["bone", "bone"],
  ["snow", "snow"],
  ["snow white", "snow"],
  ["oatmeal", "oatmeal"],
  ["oat", "oatmeal"],
  ["vanilla", "vanilla"],
  ["alabaster", "alabaster"],
  ["parchment", "parchment"],
  ["pearl", "pearl"],
  ["milk", "milk"],
  ["dove", "dove"],
  ["natural", "natural"],
  ["ecru", "ecru"],
  ["eggshell", "eggshell"],
  // Gray family
  ["cement", "cement"],
  ["putty", "putty"],
  ["pebble", "pebble"],
  ["mushroom", "mushroom"],
  ["smoke", "smoke"],
  ["fog", "fog"],
  ["mist", "mist"],
  ["heather", "heather"],
  ["pewter", "pewter"],
  ["gunmetal", "gunmetal"],
  // Brown / tan family
  ["caramel", "caramel"],
  ["cognac", "cognac"],
  ["toffee", "toffee"],
  ["chestnut", "chestnut"],
  ["mahogany", "mahogany"],
  ["walnut", "walnut"],
  ["coffee", "coffee"],
  ["latte", "latte"],
  ["truffle", "truffle"],
  ["fawn", "fawn"],
  ["almond", "almond"],
  ["biscuit", "biscuit"],
  ["wheat", "wheat"],
  ["rye", "rye"],
  ["nutmeg", "nutmeg"],
  ["cinnamon", "cinnamon"],
  ["terracotta", "terracotta"],
  ["clay", "clay"],
  ["sienna", "sienna"],
  // Blue family
  ["icy water", "icy-water"],
  ["icy-water", "icy-water"],
  ["sea", "sea"],
  ["ocean", "ocean"],
  ["lake", "lake"],
  ["sky", "sky"],
  ["midnight", "midnight"],
  ["periwinkle", "periwinkle"],
  ["cornflower", "cornflower"],
  ["sapphire", "sapphire"],
  ["azure", "azure"],
  // Green family
  ["seafoam", "seafoam"],
  ["pine", "pine"],
  ["moss", "moss"],
  ["military", "military"],
  ["hunter", "hunter"],
  ["pistachio", "pistachio"],
  ["lime", "lime"],
  ["chartreuse", "chartreuse"],
  // Yellow / gold family
  ["saffron", "saffron"],
  ["ochre", "ochre"],
  ["amber", "amber"],
  ["canary", "canary"],
  ["butter", "butter"],
  ["lemon", "lemon"],
  ["honey", "honey"],
  // Red / pink family
  ["ruby", "ruby"],
  ["crimson", "crimson"],
  ["scarlet", "scarlet"],
  ["claret", "claret"],
  ["oxblood", "oxblood"],
  ["wine", "wine"],
  ["raspberry", "raspberry"],
  ["watermelon", "watermelon"],
  ["bubblegum", "bubblegum"],
  ["dusty pink", "dusty-pink"],
  ["dusty rose", "dusty-rose"],
  ["rose", "rose"],
  ["blush", "blush"],
  ["apricot", "apricot"],
  // Purple family
  ["eggplant", "eggplant"],
  ["aubergine", "aubergine"],
  ["orchid", "orchid"],
  ["grape", "grape"],
];

// Materials - ordered by phrase length
const MATERIAL_PHRASES: [string, string][] = [
  // Multi-word materials first
  ["faux leather", "faux-leather"],
  ["vegan leather", "vegan-leather"],
  ["genuine leather", "genuine-leather"],
  ["full grain leather", "full-grain-leather"],
  ["patent leather", "patent-leather"],
  ["suede leather", "suede"],
  ["organic cotton", "organic-cotton"],
  ["pima cotton", "pima-cotton"],
  ["egyptian cotton", "egyptian-cotton"],
  ["cotton blend", "cotton-blend"],
  ["cotton linen", "cotton-linen"],
  ["cotton polyester", "cotton-poly-blend"],
  ["merino wool", "merino-wool"],
  ["virgin wool", "virgin-wool"],
  ["wool blend", "wool-blend"],
  ["cashmere blend", "cashmere-blend"],
  ["silk blend", "silk-blend"],
  ["linen blend", "linen-blend"],
  ["french terry", "french-terry"],
  ["fleece lined", "fleece-lined"],
  ["sherpa lined", "sherpa-lined"],
  ["faux fur", "faux-fur"],
  ["teddy fleece", "teddy-fleece"],
  ["stretch denim", "stretch-denim"],
  ["raw denim", "raw-denim"],
  ["selvedge denim", "selvedge-denim"],
  ["ponte knit", "ponte"],
  ["ribbed knit", "ribbed-knit"],
  ["cable knit", "cable-knit"],
  ["waffle knit", "waffle-knit"],
  ["jersey knit", "jersey"],
  ["tech fleece", "tech-fleece"],
  ["moisture wicking", "moisture-wicking"],
  ["quick dry", "quick-dry"],
  // Single-word materials
  ["cotton", "cotton"],
  ["polyester", "polyester"],
  ["nylon", "nylon"],
  ["spandex", "spandex"],
  ["elastane", "elastane"],
  ["lycra", "lycra"],
  ["rayon", "rayon"],
  ["viscose", "viscose"],
  ["modal", "modal"],
  ["tencel", "tencel"],
  ["lyocell", "lyocell"],
  ["bamboo", "bamboo"],
  ["linen", "linen"],
  ["hemp", "hemp"],
  ["silk", "silk"],
  ["satin", "satin"],
  ["chiffon", "chiffon"],
  ["velvet", "velvet"],
  ["velour", "velour"],
  ["corduroy", "corduroy"],
  ["tweed", "tweed"],
  ["twill", "twill"],
  ["flannel", "flannel"],
  ["chambray", "chambray"],
  ["poplin", "poplin"],
  ["oxford", "oxford"],
  ["canvas", "canvas"],
  ["denim", "denim"],
  ["leather", "leather"],
  ["suede", "suede"],
  ["wool", "wool"],
  ["cashmere", "cashmere"],
  ["mohair", "mohair"],
  ["angora", "angora"],
  ["alpaca", "alpaca"],
  ["fleece", "fleece"],
  ["terry", "terry"],
  ["mesh", "mesh"],
  ["lace", "lace"],
  ["crochet", "crochet"],
  ["knit", "knit"],
  ["woven", "woven"],
  ["jersey", "jersey"],
  ["ponte", "ponte"],
  ["scuba", "scuba"],
  ["neoprene", "neoprene"],
  ["sequin", "sequin"],
  ["sequins", "sequin"],
  ["beaded", "beaded"],
  ["embroidered", "embroidered"],
];

// Fit types - ordered by phrase length
const FIT_PHRASES: [string, string][] = [
  // Multi-word fits first
  ["slim fit", "slim"],
  ["skinny fit", "skinny"],
  ["regular fit", "regular"],
  ["relaxed fit", "relaxed"],
  ["loose fit", "loose"],
  ["tailored fit", "tailored"],
  ["athletic fit", "athletic"],
  ["classic fit", "classic"],
  ["modern fit", "modern"],
  ["comfort fit", "comfort"],
  ["straight fit", "straight"],
  ["tapered fit", "tapered"],
  ["wide leg", "wide-leg"],
  ["flare leg", "flare"],
  ["bootcut", "bootcut"],
  ["boyfriend fit", "boyfriend"],
  ["girlfriend fit", "girlfriend"],
  ["mom fit", "mom"],
  ["dad fit", "dad"],
  ["cropped fit", "cropped"],
  ["longline", "longline"],
  ["oversized fit", "oversized"],
  ["boxy fit", "boxy"],
  ["fitted", "fitted"],
  ["form fitting", "form-fitting"],
  ["body con", "bodycon"],
  ["a line", "a-line"],
  // Single-word fits
  ["slim", "slim"],
  ["skinny", "skinny"],
  ["regular", "regular"],
  ["relaxed", "relaxed"],
  ["loose", "loose"],
  ["oversized", "oversized"],
  ["boxy", "boxy"],
  ["fitted", "fitted"],
  ["tailored", "tailored"],
  ["cropped", "cropped"],
  ["longline", "longline"],
  ["petite", "petite"],
  ["tall", "tall"],
  ["plus", "plus-size"],
  ["curvy", "curvy"],
  ["maternity", "maternity"],
  ["stretch", "stretch"],
  ["structured", "structured"],
  ["unstructured", "unstructured"],
  ["bodycon", "bodycon"],
  ["flowy", "flowy"],
  ["draped", "draped"],
];

// Style/occasion
const STYLE_PHRASES: [string, string][] = [
  ["business casual", "business-casual"],
  ["smart casual", "smart-casual"],
  ["semi formal", "semi-formal"],
  ["black tie", "black-tie"],
  ["street style", "streetwear"],
  ["athleisure", "athleisure"],
  ["work wear", "workwear"],
  ["active wear", "activewear"],
  ["swim wear", "swimwear"],
  ["beach wear", "beachwear"],
  ["lounge wear", "loungewear"],
  ["sleep wear", "sleepwear"],
  ["night wear", "nightwear"],
  ["casual", "casual"],
  ["formal", "formal"],
  ["elegant", "elegant"],
  ["vintage", "vintage"],
  ["retro", "retro"],
  ["classic", "classic"],
  ["modern", "modern"],
  ["minimalist", "minimalist"],
  ["bohemian", "bohemian"],
  ["boho", "bohemian"],
  ["preppy", "preppy"],
  ["sporty", "sporty"],
  ["athletic", "athletic"],
  ["edgy", "edgy"],
  ["grunge", "grunge"],
  ["punk", "punk"],
  ["gothic", "gothic"],
  ["romantic", "romantic"],
  ["feminine", "feminine"],
  ["masculine", "masculine"],
  ["androgynous", "androgynous"],
  ["unisex", "unisex"],
  ["streetwear", "streetwear"],
  ["workwear", "workwear"],
  ["activewear", "activewear"],
  ["loungewear", "loungewear"],
  ["luxury", "luxury"],
  ["designer", "designer"],
  ["basic", "basic"],
  ["essential", "essential"],
  ["statement", "statement"],
  ["trendy", "trendy"],
  ["timeless", "timeless"],
];

// Gender
const GENDER_PHRASES: [string, string][] = [
  ["women", "women"],
  ["women's", "women"],
  ["womens", "women"],
  ["woman's", "women"],
  ["ladies", "women"],
  ["lady's", "women"],
  ["female", "women"],
  ["men", "men"],
  ["men's", "men"],
  ["mens", "men"],
  ["man's", "men"],
  ["gentleman's", "men"],
  ["male", "men"],
  ["boys", "boys"],
  ["boy's", "boys"],
  ["girls", "girls"],
  ["girl's", "girls"],
  ["kids", "kids"],
  ["kid's", "kids"],
  ["children's", "kids"],
  ["childrens", "kids"],
  ["toddler", "toddler"],
  ["infant", "infant"],
  ["baby", "baby"],
  ["unisex", "unisex"],
  ["gender neutral", "unisex"],
];

// Patterns
const PATTERN_PHRASES: [string, string][] = [
  ["polka dot", "polka-dot"],
  ["polka dots", "polka-dot"],
  ["pin stripe", "pinstripe"],
  ["pinstripe", "pinstripe"],
  ["pinstriped", "pinstripe"],
  ["chalk stripe", "chalk-stripe"],
  ["candy stripe", "candy-stripe"],
  ["color block", "colorblock"],
  ["colour block", "colorblock"],
  ["colorblock", "colorblock"],
  ["tie dye", "tie-dye"],
  ["tie dyed", "tie-dye"],
  ["animal print", "animal-print"],
  ["leopard print", "leopard"],
  ["zebra print", "zebra"],
  ["snake print", "snakeskin"],
  ["snakeskin", "snakeskin"],
  ["crocodile", "crocodile"],
  ["camo", "camo"],
  ["camouflage", "camo"],
  ["tropical", "tropical"],
  ["floral", "floral"],
  ["paisley", "paisley"],
  ["geometric", "geometric"],
  ["abstract", "abstract"],
  ["graphic", "graphic"],
  ["logo", "logo"],
  ["branded", "branded"],
  ["solid", "solid"],
  ["plain", "solid"],
  ["striped", "striped"],
  ["stripes", "striped"],
  ["stripe", "striped"],
  ["checked", "checked"],
  ["check", "checked"],
  ["checkered", "checked"],
  ["plaid", "plaid"],
  ["tartan", "tartan"],
  ["gingham", "gingham"],
  ["houndstooth", "houndstooth"],
  ["herringbone", "herringbone"],
  ["argyle", "argyle"],
  ["fair isle", "fair-isle"],
  ["nordic", "nordic"],
  ["aztec", "aztec"],
  ["tribal", "tribal"],
  ["ikat", "ikat"],
  ["batik", "batik"],
  ["embossed", "embossed"],
  ["quilted", "quilted"],
  ["ribbed", "ribbed"],
  ["textured", "textured"],
  ["distressed", "distressed"],
  ["washed", "washed"],
  ["faded", "faded"],
  ["acid wash", "acid-wash"],
  ["stone wash", "stone-wash"],
  ["ombre", "ombre"],
  ["gradient", "gradient"],
  ["printed", "printed"],
  ["print", "print"],
];

// Sleeve types
const SLEEVE_PHRASES: [string, string][] = [
  ["long sleeve", "long-sleeve"],
  ["long sleeved", "long-sleeve"],
  ["short sleeve", "short-sleeve"],
  ["short sleeved", "short-sleeve"],
  ["three quarter sleeve", "3/4-sleeve"],
  ["3/4 sleeve", "3/4-sleeve"],
  ["half sleeve", "half-sleeve"],
  ["cap sleeve", "cap-sleeve"],
  ["flutter sleeve", "flutter-sleeve"],
  ["bell sleeve", "bell-sleeve"],
  ["puff sleeve", "puff-sleeve"],
  ["bishop sleeve", "bishop-sleeve"],
  ["balloon sleeve", "balloon-sleeve"],
  ["dolman sleeve", "dolman-sleeve"],
  ["batwing sleeve", "batwing-sleeve"],
  ["raglan sleeve", "raglan-sleeve"],
  ["set in sleeve", "set-in-sleeve"],
  ["sleeveless", "sleeveless"],
  ["strapless", "strapless"],
  ["spaghetti strap", "spaghetti-strap"],
  ["tank", "tank"],
  ["halter", "halter"],
  ["one shoulder", "one-shoulder"],
  ["off shoulder", "off-shoulder"],
  ["cold shoulder", "cold-shoulder"],
];

// Necklines
const NECKLINE_PHRASES: [string, string][] = [
  ["crew neck", "crew-neck"],
  ["crewneck", "crew-neck"],
  ["round neck", "round-neck"],
  ["v neck", "v-neck"],
  ["vneck", "v-neck"],
  ["deep v", "deep-v"],
  ["scoop neck", "scoop-neck"],
  ["boat neck", "boat-neck"],
  ["bateau neck", "boat-neck"],
  ["square neck", "square-neck"],
  ["sweetheart", "sweetheart"],
  ["cowl neck", "cowl-neck"],
  ["turtle neck", "turtleneck"],
  ["turtleneck", "turtleneck"],
  ["mock neck", "mock-neck"],
  ["mock turtle", "mock-neck"],
  ["high neck", "high-neck"],
  ["funnel neck", "funnel-neck"],
  ["polo collar", "polo-collar"],
  ["mandarin collar", "mandarin-collar"],
  ["band collar", "band-collar"],
  ["collared", "collared"],
  ["collarless", "collarless"],
  ["hooded", "hooded"],
  ["hood", "hooded"],
  ["henley", "henley"],
  ["keyhole", "keyhole"],
  ["plunge", "plunge"],
  ["asymmetric", "asymmetric"],
];

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize title for consistent matching
 * - lowercase
 * - remove punctuation (keep hyphens and apostrophes temporarily)
 * - collapse multiple spaces
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")  // Remove punctuation except hyphen/apostrophe
    .replace(/'/g, "")           // Remove apostrophes (women's -> womens)
    .replace(/-/g, " ")          // Replace hyphens with space (t-shirt -> t shirt)
    .replace(/\s+/g, " ")        // Collapse spaces
    .trim();
}

/**
 * Generate hash for caching
 */
export function hashTitle(normalizedTitle: string): string {
  return crypto.createHash("sha256").update(normalizedTitle).digest("hex").slice(0, 16);
}

// ============================================================================
// Rule-Based Extraction (Fast Path)
// ============================================================================

/**
 * Extract phrase from text using word boundary matching
 * Returns normalized value and remaining text
 */
function extractPhrase(
  text: string,
  phrases: [string, string][]
): { value: string | null; remaining: string; confidence: number } {
  for (const [phrase, normalized] of phrases) {
    // Build regex with word boundaries
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    const match = text.match(regex);
    
    if (match) {
      // Remove matched phrase from text
      const remaining = text.replace(regex, " ").replace(/\s+/g, " ").trim();
      return { value: normalized, remaining, confidence: 1.0 };
    }
  }
  return { value: null, remaining: text, confidence: 0 };
}

/**
 * Extract all matching phrases (for colors, materials with multiple values)
 */
function extractAllPhrases(
  text: string,
  phrases: [string, string][]
): { values: string[]; confidence: number } {
  const values: string[] = [];
  let remaining = text;
  
  for (const [phrase, normalized] of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    
    if (remaining.match(regex)) {
      if (!values.includes(normalized)) {
        values.push(normalized);
      }
      remaining = remaining.replace(regex, " ").replace(/\s+/g, " ").trim();
    }
  }
  
  return { values, confidence: values.length > 0 ? 1.0 : 0 };
}

/**
 * Rule-based attribute extraction
 */
export function extractWithRules(normalizedTitle: string): {
  attributes: ExtractedAttributes;
  confidence: Record<string, number>;
} {
  const attributes: ExtractedAttributes = {};
  const confidence: Record<string, number> = {};
  let text = normalizedTitle;

  // Extract colors (can have multiple)
  const colorResult = extractAllPhrases(text, COLOR_PHRASES);
  if (colorResult.values.length > 0) {
    attributes.color = colorResult.values[0];
    attributes.colors = colorResult.values;
    confidence.color = colorResult.confidence;
  }

  // Extract materials (can have multiple)
  const materialResult = extractAllPhrases(text, MATERIAL_PHRASES);
  if (materialResult.values.length > 0) {
    attributes.material = materialResult.values[0];
    attributes.materials = materialResult.values;
    confidence.material = materialResult.confidence;
  }

  // Extract fit
  const fitResult = extractPhrase(text, FIT_PHRASES);
  if (fitResult.value) {
    attributes.fit = fitResult.value;
    confidence.fit = fitResult.confidence;
    text = fitResult.remaining;
  }

  // Extract style
  const styleResult = extractPhrase(text, STYLE_PHRASES);
  if (styleResult.value) {
    attributes.style = styleResult.value;
    confidence.style = styleResult.confidence;
    text = styleResult.remaining;
  }

  // Extract gender
  const genderResult = extractPhrase(text, GENDER_PHRASES);
  if (genderResult.value) {
    attributes.gender = genderResult.value;
    confidence.gender = genderResult.confidence;
    text = genderResult.remaining;
  }

  // Extract pattern
  const patternResult = extractPhrase(text, PATTERN_PHRASES);
  if (patternResult.value) {
    attributes.pattern = patternResult.value;
    confidence.pattern = patternResult.confidence;
    text = patternResult.remaining;
  }

  // Extract sleeve
  const sleeveResult = extractPhrase(text, SLEEVE_PHRASES);
  if (sleeveResult.value) {
    attributes.sleeve = sleeveResult.value;
    confidence.sleeve = sleeveResult.confidence;
    text = sleeveResult.remaining;
  }

  // Extract neckline
  const necklineResult = extractPhrase(text, NECKLINE_PHRASES);
  if (necklineResult.value) {
    attributes.neckline = necklineResult.value;
    confidence.neckline = necklineResult.confidence;
  }

  return { attributes, confidence };
}

// ============================================================================
// ML Fallback (Zero-Shot Classification)
// ============================================================================

let pipeline: any = null;
let mlInitialized = false;
let mlInitPromise: Promise<void> | null = null;

/**
 * Initialize ML pipeline (lazy loading)
 */
async function initML(): Promise<boolean> {
  if (mlInitialized) return pipeline !== null;
  
  if (mlInitPromise) {
    await mlInitPromise;
    return pipeline !== null;
  }

  mlInitPromise = (async () => {
    // @xenova/transformers bundles onnxruntime-web which conflicts with
    // onnxruntime-node at runtime (registers an incompatible backend and
    // causes "TypeError: not a valid backend" globally). The ML zero-shot
    // classifier is a nice-to-have fallback — disable it to keep the ONNX
    // runtime healthy for CLIP and BLIP.
    console.warn("[attributeExtractor] ML pipeline disabled — @xenova/transformers conflicts with onnxruntime-node");
    mlInitialized = true;
    pipeline = null;
  })();

  await mlInitPromise;
  return pipeline !== null;
}

// Label sets for zero-shot classification
const COLOR_LABELS = ["black", "white", "red", "blue", "green", "yellow", "pink", "purple", "brown", "gray", "beige", "navy", "orange"];
const MATERIAL_LABELS = ["cotton", "polyester", "leather", "denim", "wool", "silk", "linen", "nylon", "synthetic", "knit"];
const FIT_LABELS = ["slim fit", "regular fit", "loose fit", "oversized", "fitted", "relaxed"];

/**
 * Extract attributes using ML (zero-shot classification)
 */
async function extractWithML(
  normalizedTitle: string,
  missingAttributes: string[],
  threshold: number = 0.7
): Promise<{ attributes: Partial<ExtractedAttributes>; confidence: Record<string, number> }> {
  const attributes: Partial<ExtractedAttributes> = {};
  const confidence: Record<string, number> = {};

  const mlAvailable = await initML();
  if (!mlAvailable || !pipeline) {
    return { attributes, confidence };
  }

  try {
    // Extract color if missing
    if (missingAttributes.includes("color")) {
      const result = await pipeline(normalizedTitle, COLOR_LABELS, {
        multi_label: false,
      });
      if (result.scores[0] >= threshold) {
        attributes.color = result.labels[0];
        confidence.color = result.scores[0];
      }
    }

    // Extract material if missing
    if (missingAttributes.includes("material")) {
      const result = await pipeline(normalizedTitle, MATERIAL_LABELS, {
        multi_label: false,
      });
      if (result.scores[0] >= threshold) {
        attributes.material = result.labels[0];
        confidence.material = result.scores[0];
      }
    }

    // Extract fit if missing
    if (missingAttributes.includes("fit")) {
      const result = await pipeline(normalizedTitle, FIT_LABELS, {
        multi_label: false,
      });
      if (result.scores[0] >= threshold) {
        attributes.fit = result.labels[0].replace(" fit", "");
        confidence.fit = result.scores[0];
      }
    }
  } catch (err) {
    console.warn("ML extraction failed:", err);
  }

  return { attributes, confidence };
}

// ============================================================================
// Caching Layer
// ============================================================================

// In-memory cache (replace with Redis/DB for production at scale)
const extractionCache = new Map<string, ExtractionResult>();
const CACHE_MAX_SIZE = 10000;

/**
 * Get cached extraction result
 */
export function getCached(hash: string): ExtractionResult | null {
  const cached = extractionCache.get(hash);
  if (cached && cached.version === EXTRACTOR_VERSION) {
    return cached;
  }
  return null;
}

/**
 * Cache extraction result
 */
export function setCache(hash: string, result: ExtractionResult): void {
  // Simple LRU-like eviction
  if (extractionCache.size >= CACHE_MAX_SIZE) {
    const firstKey = extractionCache.keys().next().value;
    if (firstKey) extractionCache.delete(firstKey);
  }
  extractionCache.set(hash, result);
}

/**
 * Clear cache (useful when dictionaries are updated)
 */
export function clearCache(): void {
  extractionCache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; maxSize: number; version: string } {
  return {
    size: extractionCache.size,
    maxSize: CACHE_MAX_SIZE,
    version: EXTRACTOR_VERSION,
  };
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract attributes from product title
 * 
 * 1. Normalize and hash title
 * 2. Check cache
 * 3. Run rule-based extraction (fast path)
 * 4. If core attributes missing, run ML fallback
 * 5. Cache and return result
 */
export async function extractAttributes(
  title: string,
  options: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const { useML = true, mlThreshold = 0.7 } = options;

  // Normalize and hash
  const normalizedTitle = normalizeTitle(title);
  const hash = hashTitle(normalizedTitle);

  // Check cache
  const cached = getCached(hash);
  if (cached) {
    return cached;
  }

  // Rule-based extraction (fast path)
  const { attributes, confidence } = extractWithRules(normalizedTitle);
  let extractor: "rules" | "ml" | "hybrid" = "rules";

  // ML fallback for missing core attributes
  if (useML) {
    const missingAttributes: string[] = [];
    if (!attributes.color) missingAttributes.push("color");
    if (!attributes.material) missingAttributes.push("material");
    if (!attributes.fit) missingAttributes.push("fit");

    if (missingAttributes.length > 0) {
      const mlResult = await extractWithML(normalizedTitle, missingAttributes, mlThreshold);
      
      // Merge ML results
      if (Object.keys(mlResult.attributes).length > 0) {
        extractor = "hybrid";
        Object.assign(attributes, mlResult.attributes);
        Object.assign(confidence, mlResult.confidence);
      }
    }
  }

  // Build result
  const result: ExtractionResult = {
    attributes,
    confidence,
    extractor,
    version: EXTRACTOR_VERSION,
    normalized_title: normalizedTitle,
    hash,
  };

  // Cache result
  setCache(hash, result);

  return result;
}

/**
 * Synchronous rule-only extraction (for high-throughput indexing)
 * Skips ML fallback and caching overhead
 */
export function extractAttributesSync(title: string): {
  attributes: ExtractedAttributes;
  confidence: Record<string, number>;
  normalized_title: string;
  hash: string;
} {
  const normalizedTitle = normalizeTitle(title);
  const hash = hashTitle(normalizedTitle);
  
  // Check cache first
  const cached = getCached(hash);
  if (cached) {
    return {
      attributes: cached.attributes,
      confidence: cached.confidence,
      normalized_title: cached.normalized_title,
      hash: cached.hash,
    };
  }

  const { attributes, confidence } = extractWithRules(normalizedTitle);
  
  // Cache for future use
  setCache(hash, {
    attributes,
    confidence,
    extractor: "rules",
    version: EXTRACTOR_VERSION,
    normalized_title: normalizedTitle,
    hash,
  });

  return { attributes, confidence, normalized_title: normalizedTitle, hash };
}

/**
 * Batch extraction for indexing (rules-only, high throughput)
 */
export function extractAttributesBatch(
  titles: string[]
): Map<string, { attributes: ExtractedAttributes; confidence: Record<string, number> }> {
  const results = new Map();
  
  for (const title of titles) {
    const { attributes, confidence, hash } = extractAttributesSync(title);
    results.set(hash, { attributes, confidence, title });
  }
  
  return results;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all known colors (for facets)
 */
export function getKnownColors(): string[] {
  const colors = new Set<string>();
  for (const [, normalized] of COLOR_PHRASES) {
    colors.add(normalized);
  }
  return Array.from(colors).sort();
}

/**
 * Get all known materials (for facets)
 */
export function getKnownMaterials(): string[] {
  const materials = new Set<string>();
  for (const [, normalized] of MATERIAL_PHRASES) {
    materials.add(normalized);
  }
  return Array.from(materials).sort();
}

/**
 * Get all known fits (for facets)
 */
export function getKnownFits(): string[] {
  const fits = new Set<string>();
  for (const [, normalized] of FIT_PHRASES) {
    fits.add(normalized);
  }
  return Array.from(fits).sort();
}

/**
 * Validate extracted attributes against known values
 */
export function validateAttributes(attrs: ExtractedAttributes): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const knownColors = new Set(getKnownColors());
  const knownMaterials = new Set(getKnownMaterials());
  const knownFits = new Set(getKnownFits());

  if (attrs.color && !knownColors.has(attrs.color)) {
    warnings.push(`Unknown color: ${attrs.color}`);
  }
  if (attrs.material && !knownMaterials.has(attrs.material)) {
    warnings.push(`Unknown material: ${attrs.material}`);
  }
  if (attrs.fit && !knownFits.has(attrs.fit)) {
    warnings.push(`Unknown fit: ${attrs.fit}`);
  }

  return { valid: warnings.length === 0, warnings };
}
