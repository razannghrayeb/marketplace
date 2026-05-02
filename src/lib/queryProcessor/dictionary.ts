/**
 * Dictionary Manager
 * 
 * Manages dictionaries for brands, categories, attributes, and common queries.
 * Handles loading, caching, and precomputing embeddings.
 */

import { DictionaryEntry, Dictionary } from "./types";
import { pg } from "../core";
import { getTextEmbedding } from "../image";
import { normalizeArabic, arabicToArabizi, arabiziToArabic } from "./arabizi";

// ============================================================================
// Version Control
// ============================================================================

const DICTIONARY_VERSION = "1.0.0";

// ============================================================================
// Static Dictionaries (built-in)
// ============================================================================

// Brand data with aliases
const BRAND_DATA: Array<{
  name: string;
  aliases: string[];
  arabic?: string;
  arabizi?: string;
  popularity: number;
}> = [
  { name: "Nike", aliases: ["naik", "naiki", "nik"], arabic: "نايك", arabizi: "naik", popularity: 0.95 },
  { name: "Adidas", aliases: ["addidas", "adiddas", "adidass"], arabic: "أديداس", arabizi: "adidas", popularity: 0.93 },
  { name: "Puma", aliases: ["pooma", "poma"], arabic: "بوما", arabizi: "boma", popularity: 0.85 },
  { name: "Reebok", aliases: ["rebok", "ribok", "reibok"], arabic: "ريبوك", arabizi: "ribok", popularity: 0.75 },
  { name: "New Balance", aliases: ["newbalance", "nb", "new balanse"], arabic: "نيو بالانس", popularity: 0.80 },
  { name: "Under Armour", aliases: ["underarmor", "under armor", "ua"], arabic: "أندر آرمور", popularity: 0.78 },
  { name: "Levi's", aliases: ["levis", "levi", "levais", "livais"], arabic: "ليفايز", arabizi: "livais", popularity: 0.88 },
  { name: "Zara", aliases: ["zaara", "zarra"], arabic: "زارا", arabizi: "zara", popularity: 0.90 },
  { name: "H&M", aliases: ["hm", "h and m", "h&m", "h m"], arabic: "إتش آند إم", popularity: 0.89 },
  { name: "Uniqlo", aliases: ["uniklo", "uniqolo", "uniqelo"], arabic: "يونيكلو", popularity: 0.82 },
  { name: "Gucci", aliases: ["guchi", "goochi", "guci"], arabic: "غوتشي", arabizi: "guchi", popularity: 0.92 },
  { name: "Louis Vuitton", aliases: ["lv", "louis viton", "loui vuitton", "luois vuitton"], arabic: "لويس فيتون", popularity: 0.91 },
  { name: "Prada", aliases: ["prada", "pradda"], arabic: "برادا", popularity: 0.88 },
  { name: "Chanel", aliases: ["chanel", "shanell", "channel"], arabic: "شانيل", arabizi: "shanel", popularity: 0.90 },
  { name: "Dior", aliases: ["dior", "deor", "dioor"], arabic: "ديور", popularity: 0.89 },
  { name: "Versace", aliases: ["versachi", "versace", "versase"], arabic: "فيرساتشي", popularity: 0.85 },
  { name: "Ralph Lauren", aliases: ["polo", "ralph loren", "rl"], arabic: "رالف لورين", popularity: 0.86 },
  { name: "Tommy Hilfiger", aliases: ["tommy", "hilfiger", "tomy hilfiger"], arabic: "تومي هيلفيغر", popularity: 0.84 },
  { name: "Calvin Klein", aliases: ["ck", "calvin klien", "kalvin klein"], arabic: "كالفن كلاين", popularity: 0.85 },
  { name: "Armani", aliases: ["armanni", "armani", "giorgio armani"], arabic: "أرماني", popularity: 0.83 },
  { name: "The North Face", aliases: ["north face", "tnf", "northface"], arabic: "ذا نورث فيس", popularity: 0.82 },
  { name: "Patagonia", aliases: ["patagonia", "patogonia"], arabic: "باتاغونيا", popularity: 0.75 },
  { name: "Columbia", aliases: ["colombia", "kolumbia"], arabic: "كولومبيا", popularity: 0.78 },
  { name: "Mango", aliases: ["mango", "mangoo"], arabic: "مانجو", popularity: 0.80 },
  { name: "Massimo Dutti", aliases: ["massimo duti", "masimo dutti"], arabic: "ماسيمو دوتي", popularity: 0.76 },
  { name: "Pull & Bear", aliases: ["pull and bear", "pullbear", "pull bear"], arabic: "بول آند بير", popularity: 0.75 },
  { name: "Bershka", aliases: ["bershka", "bershkaa"], arabic: "بيرشكا", popularity: 0.74 },
  { name: "Stradivarius", aliases: ["stradivarius", "strad"], arabic: "سترادفاريوس", popularity: 0.72 },
];

// Category data
const CATEGORY_DATA: Array<{
  name: string;
  aliases: string[];
  arabic?: string;
  arabizi?: string;
  popularity: number;
}> = [
  { name: "tops", aliases: ["top", "shirts", "shirt", "blouse", "blouses", "tshirt", "t-shirt", "tee", "tank", "tank top", "polo", "sweater", "hoodie", "sweatshirt", "pullover", "henley", "tunic", "crop top", "camisole", "vest top", "sleeveless vest top"], arabic: "قمصان", arabizi: "qomsan", popularity: 0.9 },
  { name: "bottoms", aliases: ["bottom", "pants", "pant", "trousers", "trouser", "jeans", "jean", "chinos", "chino", "leggings", "legging", "shorts", "short", "skirt", "skirts", "culottes", "sweatpants", "cargo"], arabic: "بناطيل", arabizi: "banatil", popularity: 0.85 },
  { name: "joggers", aliases: ["jogger", "jogging pants", "jogging", "jogging bottoms", "track pants", "trackpants"], arabic: "بنطلون جوجينج", arabizi: "jogging", popularity: 0.75 },
  { name: "dresses", aliases: ["dress", "gown", "frock", "maxi", "midi", "sundress", "jumpsuit", "romper"], arabic: "فساتين", arabizi: "fsatin", popularity: 0.88 },
  { name: "tailored", aliases: ["tailored", "suit", "suits", "tuxedo", "tuxedos", "suit jacket", "suit jackets", "dress jacket", "dress jackets", "waistcoat", "waistcoats", "vest", "vests", "gilet", "gilets", "tailored jacket", "tailored jackets", "structured jacket", "structured jackets"], arabic: "بدلات", arabizi: "bidalat", popularity: 0.79 },
  { name: "outerwear", aliases: ["jacket", "jackets", "coat", "coats", "blazer", "blazers", "cardigan", "cardigans", "parka", "windbreaker", "trench", "poncho", "sport coat"], arabic: "جاكيتات", arabizi: "jaketaat", popularity: 0.82 },
  { name: "footwear", aliases: ["shoes", "shoe", "sneakers", "sneaker", "boots", "boot", "sandals", "sandal", "heels", "heel", "loafers", "loafer", "flats", "flat", "mules", "slides", "slippers", "pumps", "trainers", "trainer", "oxfords"], arabic: "أحذية", arabizi: "a7thya", popularity: 0.87 },
  { name: "accessories", aliases: ["accessory", "bag", "bags", "belt", "belts", "hat", "hats", "cap", "watch", "watches", "scarf", "scarves", "sunglasses", "jewelry", "bracelet", "necklace", "earrings", "wallet", "purse", "handbag", "tote", "backpack", "clutch"], arabic: "إكسسوارات", arabizi: "akseswaraat", popularity: 0.80 },
  { name: "activewear", aliases: ["sportswear", "athletic", "gym", "workout", "running", "yoga", "training", "sports bra", "track pants", "performance"], arabic: "ملابس رياضية", arabizi: "malabes riyadya", popularity: 0.78 },
  { name: "swimwear", aliases: ["swim", "swimming", "bikini", "swimsuit", "swim trunks", "board shorts", "beach wear"], arabic: "ملابس سباحة", arabizi: "malabes sba7a", popularity: 0.65 },
  { name: "underwear", aliases: ["lingerie", "undergarments", "innerwear", "boxers", "briefs", "bra", "panties", "undershirt"], arabic: "ملابس داخلية", arabizi: "malabes dakhleya", popularity: 0.60 },
  {
    name: "modest wear",
    aliases: [
      "modest",
      "abaya",
      "abayas",
      "kaftan",
      "thobe",
      "thawb",
      "jalabiya",
      "bisht",
      "hijab",
      "hijabs",
      "headscarf",
      "niqab",
      "burqa",
      "sherwani",
      "kurta",
      "kurti",
      "sari",
      "saree",
      "salwar",
      "kameez",
      "lehenga",
      "lengha",
      "dupatta",
      "dirac",
      "churidar",
    ],
    popularity: 0.82,
  },
];

// Attribute data (colors, materials, fits, genders)
const ATTRIBUTE_DATA: Array<{
  name: string;
  type: "color" | "material" | "fit" | "gender" | "style";
  aliases: string[];
  arabic?: string;
  arabizi?: string;
  popularity: number;
}> = [
  // Colors
  { name: "black", type: "color", aliases: ["blak", "blck", "balck", "blac", "blacc"], arabic: "أسود", arabizi: "aswad", popularity: 0.95 },
  { name: "white", type: "color", aliases: ["wite", "whit", "whte", "whtie", "withe", "whiet"], arabic: "أبيض", arabizi: "abyad", popularity: 0.93 },
  { name: "red", type: "color", aliases: ["redd", "rd"], arabic: "أحمر", arabizi: "a7mar", popularity: 0.88 },
  { name: "blue", type: "color", aliases: ["bleu", "blu", "bule", "bluw"], arabic: "أزرق", arabizi: "azra2", popularity: 0.90 },
  { name: "green", type: "color", aliases: ["gren", "grean", "geen", "gree"], arabic: "أخضر", arabizi: "akhdar", popularity: 0.82 },
  { name: "yellow", type: "color", aliases: ["yelow", "yello", "yellw", "yelo"], arabic: "أصفر", arabizi: "asfar", popularity: 0.70 },
  { name: "pink", type: "color", aliases: ["pnk", "pnik", "pinl"], arabic: "وردي", arabizi: "wardi", popularity: 0.78 },
  { name: "purple", type: "color", aliases: ["purpl", "violet", "pruple", "purpel", "purpple"], arabic: "بنفسجي", arabizi: "banafsaji", popularity: 0.72 },
  { name: "orange", type: "color", aliases: ["orenge", "orang", "ornage"], arabic: "برتقالي", arabizi: "borto2ali", popularity: 0.68 },
  { name: "brown", type: "color", aliases: ["brwn", "brow", "borwn", "broen"], arabic: "بني", arabizi: "bonni", popularity: 0.75 },
  { name: "gray", type: "color", aliases: ["grey", "gry", "gery", "graey"], arabic: "رمادي", arabizi: "ramadi", popularity: 0.80 },
  { name: "beige", type: "color", aliases: ["bege", "biege", "beig", "biej"], arabic: "بيج", arabizi: "beige", popularity: 0.72 },
  { name: "navy", type: "color", aliases: ["navy blue", "nawy", "navey"], arabic: "كحلي", arabizi: "ka7li", popularity: 0.78 },
  
  // Materials
  { name: "cotton", type: "material", aliases: ["coton", "cotten"], arabic: "قطن", arabizi: "qoton", popularity: 0.90 },
  { name: "leather", type: "material", aliases: ["lether", "lethr"], arabic: "جلد", arabizi: "jild", popularity: 0.85 },
  { name: "denim", type: "material", aliases: ["jeans", "jean"], arabic: "جينز", arabizi: "jeans", popularity: 0.88 },
  { name: "silk", type: "material", aliases: ["silck"], arabic: "حرير", arabizi: "7arir", popularity: 0.75 },
  { name: "wool", type: "material", aliases: ["woolen", "wol"], arabic: "صوف", arabizi: "soof", popularity: 0.72 },
  { name: "polyester", type: "material", aliases: ["polyster", "polister"], arabic: "بوليستر", arabizi: "polyester", popularity: 0.78 },
  { name: "linen", type: "material", aliases: ["linin", "linnen"], arabic: "كتان", arabizi: "kattan", popularity: 0.70 },
  
  // Fits
  { name: "slim", type: "fit", aliases: ["slim fit", "slimfit", "skinny"], arabic: "ضيق", arabizi: "dayye2", popularity: 0.85 },
  { name: "regular", type: "fit", aliases: ["regular fit", "normal"], arabic: "عادي", arabizi: "3adi", popularity: 0.80 },
  { name: "loose", type: "fit", aliases: ["loose fit", "relaxed", "oversized"], arabic: "واسع", arabizi: "wase3", popularity: 0.75 },
  
  // Genders
  { name: "men", type: "gender", aliases: ["mens", "male", "man"], arabic: "رجالي", arabizi: "rijali", popularity: 0.90 },
  { name: "women", type: "gender", aliases: ["womens", "female", "woman", "ladies", "lady"], arabic: "نسائي", arabizi: "nisa2i", popularity: 0.90 },
  { name: "kids", type: "gender", aliases: ["children", "child", "boys", "girls", "unisex kids"], arabic: "أطفال", arabizi: "atfal", popularity: 0.75 },
  { name: "unisex", type: "gender", aliases: ["gender neutral"], arabic: "للجنسين", arabizi: "liljinsain", popularity: 0.65 },
  
  // Styles
  { name: "casual", type: "style", aliases: ["casuel"], arabic: "كاجوال", arabizi: "casual", popularity: 0.88 },
  { name: "formal", type: "style", aliases: ["formel", "business"], arabic: "رسمي", arabizi: "rasmi", popularity: 0.80 },
  { name: "sporty", type: "style", aliases: ["sport", "athletic"], arabic: "رياضي", arabizi: "riyadi", popularity: 0.78 },
  { name: "vintage", type: "style", aliases: ["retro", "vintege"], arabic: "فينتاج", arabizi: "vintage", popularity: 0.72 },
  { name: "elegant", type: "style", aliases: ["elegent", "classy"], arabic: "أنيق", arabizi: "ani2", popularity: 0.75 },
];

// Common query patterns
const COMMON_QUERIES: Array<{
  query: string;
  aliases: string[];
  arabic?: string;
  arabizi?: string;
  popularity: number;
}> = [
  { query: "black dress", aliases: ["blak dress", "black dres", "blck dress"], arabic: "فستان أسود", arabizi: "fostan aswad", popularity: 0.85 },
  { query: "white shirt", aliases: ["wite shirt", "white shrit", "whit shirt", "white shrt"], arabic: "قميص أبيض", arabizi: "qamees abyad", popularity: 0.88 },
  { query: "white pants", aliases: ["whit pants", "wite pants", "white pant", "whit pant", "white pnts"], arabic: "بنطلون أبيض", arabizi: "bantalon abyad", popularity: 0.82 },
  { query: "black pants", aliases: ["blak pants", "black pant", "blck pants", "balck pants"], arabic: "بنطلون أسود", arabizi: "bantalon aswad", popularity: 0.82 },
  { query: "blue jeans", aliases: ["blu jeans", "blue jeens", "bleu jeans"], arabic: "جينز أزرق", arabizi: "jeans azra2", popularity: 0.90 },
  { query: "running shoes", aliases: ["runing shoes", "run shoes", "running shoe"], arabic: "حذاء رياضي", arabizi: "7itha2 riyadi", popularity: 0.82 },
  { query: "leather jacket", aliases: ["lether jacket", "leather jaket", "leathr jacket"], arabic: "جاكيت جلد", arabizi: "jaket jild", popularity: 0.80 },
  { query: "summer dress", aliases: ["sumer dress", "summr dress"], arabic: "فستان صيفي", arabizi: "fostan saifi", popularity: 0.78 },
  { query: "winter coat", aliases: ["winter cot", "wintr coat", "winter cote"], arabic: "كوت شتوي", arabizi: "koot shatwi", popularity: 0.75 },
  { query: "red dress", aliases: ["redd dress", "red dres"], arabic: "فستان أحمر", arabizi: "fostan a7mar", popularity: 0.80 },
  { query: "blue shirt", aliases: ["blu shirt", "blue shrit", "bleu shirt"], arabic: "قميص أزرق", arabizi: "qamees azra2", popularity: 0.80 },
  { query: "black shoes", aliases: ["blak shoes", "black sheos", "black shoe"], arabic: "حذاء أسود", arabizi: "7itha2 aswad", popularity: 0.82 },
  { query: "white sneakers", aliases: ["wite sneakers", "white sneaker", "whit sneakers"], arabic: "سنيكرز أبيض", arabizi: "sneakers abyad", popularity: 0.78 },
  { query: "casual shirt", aliases: ["casuel shirt", "casual shrt"], arabic: "قميص كاجوال", arabizi: "qamees casual", popularity: 0.75 },
  { query: "slim fit jeans", aliases: ["slim jeans", "slimfit jeans", "slim jean"], arabic: "جينز ضيق", arabizi: "jeans dayye2", popularity: 0.75 },
  { query: "hoodie", aliases: ["hoody", "hudie", "hudi"], arabic: "هودي", arabizi: "hoodi", popularity: 0.78 },
  { query: "sneakers", aliases: ["sneekers", "sneaker", "snekers", "snakers"], arabic: "سنيكرز", arabizi: "sneakers", popularity: 0.82 },
  { query: "t-shirt", aliases: ["tshirt", "tee shirt", "tee-shirt", "teeshirt"], arabic: "تيشيرت", arabizi: "teeshirt", popularity: 0.88 },
];

// ============================================================================
// Dictionary Builder
// ============================================================================

let cachedDictionary: Dictionary | null = null;

/**
 * Build dictionary entry with all forms
 */
function buildEntry(
  data: {
    name: string;
    aliases?: string[];
    arabic?: string;
    arabizi?: string;
    popularity: number;
  },
  type: DictionaryEntry["type"]
): DictionaryEntry {
  const allAliases = [...(data.aliases || [])];
  
  // Add Arabic/Arabizi forms as aliases
  if (data.arabic) {
    allAliases.push(data.arabic);
    allAliases.push(normalizeArabic(data.arabic));
  }
  if (data.arabizi) {
    allAliases.push(data.arabizi);
    // Also add the Arabic transliteration of Arabizi
    allAliases.push(arabiziToArabic(data.arabizi));
  }
  
  return {
    term: data.name,
    normalizedTerm: data.name.toLowerCase(),
    type,
    aliases: allAliases,
    arabicForm: data.arabic,
    arabiziForm: data.arabizi,
    popularity: data.popularity,
  };
}

/**
 * Build all dictionaries from static data
 */
export function buildDictionaries(): Dictionary {
  const brands = new Map<string, DictionaryEntry>();
  const categories = new Map<string, DictionaryEntry>();
  const attributes = new Map<string, DictionaryEntry>();
  const commonQueries = new Map<string, DictionaryEntry>();
  
  // Build brands dictionary
  for (const brand of BRAND_DATA) {
    const entry = buildEntry(brand, "brand");
    brands.set(brand.name.toLowerCase(), entry);
    
    // Also index by aliases for quick lookup
    for (const alias of entry.aliases || []) {
      if (!brands.has(alias.toLowerCase())) {
        brands.set(alias.toLowerCase(), entry);
      }
    }
  }
  
  // Build categories dictionary
  for (const category of CATEGORY_DATA) {
    const entry = buildEntry(category, "category");
    categories.set(category.name.toLowerCase(), entry);
    
    for (const alias of entry.aliases || []) {
      if (!categories.has(alias.toLowerCase())) {
        categories.set(alias.toLowerCase(), entry);
      }
    }
  }
  
  // Build attributes dictionary
  for (const attr of ATTRIBUTE_DATA) {
    const entry = buildEntry(attr, "attribute");
    attributes.set(attr.name.toLowerCase(), entry);
    
    for (const alias of entry.aliases || []) {
      if (!attributes.has(alias.toLowerCase())) {
        attributes.set(alias.toLowerCase(), entry);
      }
    }
  }
  
  // Build common queries dictionary
  for (const query of COMMON_QUERIES) {
    const entry = buildEntry({ name: query.query, ...query }, "common_query");
    commonQueries.set(query.query.toLowerCase(), entry);
    
    for (const alias of entry.aliases || []) {
      if (!commonQueries.has(alias.toLowerCase())) {
        commonQueries.set(alias.toLowerCase(), entry);
      }
    }
  }
  
  return {
    brands,
    categories,
    attributes,
    commonQueries,
    version: DICTIONARY_VERSION,
    lastUpdated: new Date(),
  };
}

/**
 * Get or build dictionaries (cached)
 */
export function getDictionaries(): Dictionary {
  if (!cachedDictionary) {
    cachedDictionary = buildDictionaries();
    console.log(`Dictionary loaded: ${cachedDictionary.brands.size} brands, ${cachedDictionary.categories.size} categories, ${cachedDictionary.attributes.size} attributes`);
  }
  return cachedDictionary;
}

/**
 * Load additional brands from database
 */
export async function loadBrandsFromDB(): Promise<void> {
  try {
    const dictionary = getDictionaries();
    const result = await pg.query(
      `SELECT DISTINCT brand, COUNT(*) as cnt 
       FROM products 
       WHERE brand IS NOT NULL 
       GROUP BY brand 
       ORDER BY cnt DESC 
       LIMIT 500`
    );
    
    for (const row of result.rows) {
      const brand = row.brand;
      const count = parseInt(row.cnt);
      const normalizedBrand = brand.toLowerCase();
      
      if (!dictionary.brands.has(normalizedBrand)) {
        // Calculate popularity based on product count (normalized)
        const popularity = Math.min(0.9, count / 100);
        
        dictionary.brands.set(normalizedBrand, {
          term: brand,
          normalizedTerm: normalizedBrand,
          type: "brand",
          popularity,
        });
      }
    }
    
    console.log(`Loaded ${result.rowCount} brands from database`);
  } catch (err) {
    console.warn("Could not load brands from DB:", err);
  }
}

/**
 * Load additional categories from database
 */
export async function loadCategoriesFromDB(): Promise<void> {
  try {
    const dictionary = getDictionaries();
    const result = await pg.query(
      `SELECT DISTINCT category, COUNT(*) as cnt 
       FROM products 
       WHERE category IS NOT NULL 
       GROUP BY category 
       ORDER BY cnt DESC 
       LIMIT 100`
    );
    
    for (const row of result.rows) {
      const category = row.category;
      const normalizedCategory = category.toLowerCase();
      
      if (!dictionary.categories.has(normalizedCategory)) {
        const count = parseInt(row.cnt);
        const popularity = Math.min(0.9, count / 50);
        
        dictionary.categories.set(normalizedCategory, {
          term: category,
          normalizedTerm: normalizedCategory,
          type: "category",
          popularity,
        });
      }
    }
    
    console.log(`Loaded ${result.rowCount} categories from database`);
  } catch (err) {
    console.warn("Could not load categories from DB:", err);
  }
}

/**
 * Precompute embeddings for dictionary entries (optional, for semantic matching)
 */
export async function precomputeEmbeddings(): Promise<void> {
  const dictionary = getDictionaries();
  let computed = 0;
  
  try {
    // Only compute for brands and categories (most important)
    for (const [, entry] of dictionary.brands) {
      if (!entry.embedding) {
        try {
          entry.embedding = await getTextEmbedding(entry.term);
          computed++;
        } catch (err) {
          // Skip if embedding fails
        }
      }
    }
    
    for (const [, entry] of dictionary.categories) {
      if (!entry.embedding) {
        try {
          entry.embedding = await getTextEmbedding(entry.term);
          computed++;
        } catch (err) {
          // Skip if embedding fails
        }
      }
    }
    
    console.log(`Precomputed ${computed} embeddings for dictionary entries`);
  } catch (err) {
    console.warn("Could not precompute embeddings:", err);
  }
}

/**
 * Clear dictionary cache (for testing or reloading)
 */
export function clearDictionaryCache(): void {
  cachedDictionary = null;
}

/**
 * Get dictionary stats
 */
export function getDictionaryStats(): {
  brands: number;
  categories: number;
  attributes: number;
  commonQueries: number;
  version: string;
} {
  const dict = getDictionaries();
  return {
    brands: dict.brands.size,
    categories: dict.categories.size,
    attributes: dict.attributes.size,
    commonQueries: dict.commonQueries.size,
    version: dict.version,
  };
}

// ============================================================================
// Lookup Functions
// ============================================================================

/**
 * Find brand by name (exact or fuzzy)
 */
export function findBrand(name: string): DictionaryEntry | null {
  const dict = getDictionaries();
  const normalized = name.toLowerCase().trim();
  return dict.brands.get(normalized) || null;
}

/**
 * Find category by name
 */
export function findCategory(name: string): DictionaryEntry | null {
  const dict = getDictionaries();
  const normalized = name.toLowerCase().trim();
  return dict.categories.get(normalized) || null;
}

/**
 * Find attribute by name
 */
export function findAttribute(name: string): DictionaryEntry | null {
  const dict = getDictionaries();
  const normalized = name.toLowerCase().trim();
  return dict.attributes.get(normalized) || null;
}

/**
 * Get all known brand names
 */
export function getAllBrandNames(): string[] {
  const dict = getDictionaries();
  const names = new Set<string>();
  for (const entry of dict.brands.values()) {
    names.add(entry.term);
  }
  return Array.from(names);
}

/**
 * Get all known category names
 */
export function getAllCategoryNames(): string[] {
  const dict = getDictionaries();
  const names = new Set<string>();
  for (const entry of dict.categories.values()) {
    names.add(entry.term);
  }
  return Array.from(names);
}

/**
 * Get all known gender values
 */
export function getAllGenders(): string[] {
  const dict = getDictionaries();
  return Array.from(dict.attributes.values())
    .filter(e => (e as any).type === "gender" || e.term === "men" || e.term === "women" || e.term === "kids" || e.term === "unisex")
    .map(e => e.term);
}
