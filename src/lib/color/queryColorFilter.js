"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_CANONICAL_ALIASES = void 0;
exports.inferColorGroupFromRaw = inferColorGroupFromRaw;
exports.normalizeColorToken = normalizeColorToken;
exports.normalizeColorTokensFromRaw = normalizeColorTokensFromRaw;
exports.expandColorTermsForFilter = expandColorTermsForFilter;
const colorCanonical_1 = require("./colorCanonical");
/**
 * Query-time color normalization and OpenSearch filter term expansion (shared by text + image search).
 */
exports.COLOR_CANONICAL_ALIASES = {
    black: [
        "black", "jet", "onyx", "heathered black",
        "heathered_black", "core black", "tnf black", "all black", "total black", "blackout",
        "black out", "raven", "ebony", "obsidian", "noir", "nero", "caviar", "ink black",
        "night black", "phantom black", "carbon black", "washed black", "faded black",
        "matte black", "mat black", "black heather", "black denim", "black rinse",
        "onix", "aurora onix", "raven black", "black as night", "off noir", "eclipse",
        "dark matter",
    ],
    white: [
        "white", "off white", "off-white", "offwhite", "ivory", "cream", "bone", "ecru",
        "natural", "sail", "summit white", "cloud white", "wonder white", "cream white",
        "chalk white", "vintage white", "gardenia white", "optic white", "optical white",
        "bright white", "snow white", "tnf white", "egret", "alabaster", "milk white",
        "coconut milk", "vanilla", "flour", "parchment", "paper white", "marshmallow",
        "winter white", "warm white", "broken white", "star white", "sea salt", "seasalt",
        "pearl white", "undyed white", "whitecap", "white cap",
        "pearl", "moonbeam", "soapstone", "salt", "alpine snow", "cheese white",
        "smoked pearl", "white dune", "crystal white", "frost", "warm ivory",
        "cool vanilla", "bone white", "paper", "crema", "white eyelet",
    ],
    gray: [
        "gray", "grey", "heather grey", "heather gray", "silver", "charcoal",
        "dark gray", "dark grey", "wolf grey", "wolf gray",
        "smoke grey", "smoke gray", "light smoke grey", "dark smoke grey", "iron grey",
        "castlerock", "castle grey", "vast grey", "dove grey", "college grey", "halo gray",
        "halo grey", "titan gray", "titan grey", "thunder", "thunderstorm", "raincloud",
        "downpour", "storm", "stormy", "tempest", "cinder", "carbon", "forged iron",
        "magnet", "asphalt", "concrete", "cement", "pebble", "gravel", "pewter",
        "gunmetal", "graphite", "tungsten", "alloy", "aluminium", "aluminum", "platinum",
        "metallic silver", "silver metallic", "lunar silver", "chrome", "steel", "lead",
        "fog", "mist", "cloud grey", "cloud gray", "glacier grey", "glacier gray",
        "galactic grey", "moonstone", "quiet shade", "turbulence", "ironstone", "coal",
        "glacier", "castlerock", "earth day grey", "medium ash", "medium grey",
        "silver melee", "storm front", "foggy grey", "grey skies", "cosmic grey",
        "mindful grey", "dash grey", "meteor grey", "vanadis grey", "shipyard",
        "asphlat", "asphalt grey", "inviting grey", "soot", "heathered soot",
        "taupe grey", "tungsten rinse", "tungsten blue stone",
    ],
    blue: [
        "blue", "navy", "cobalt", "denim", "sky blue", "mid blue", "midnight blue",
        "royal blue", "royal-blue", "light blue", "light-blue", "powder blue", "baby blue",
        "teal", "turquoise", "indigo", "electric blue", "sapphire", "marine", "azure",
        "lapis", "petrol", "atlantic", "ocean", "cerulean", "cornflower", "periwinkle",
        "celeste", "niagara", "reef", "pool", "lagoon", "clear sky", "blue smoke",
        "smoky blue", "smokey blue", "blue cendre", "blue atlantis", "hero blue",
        "game royal", "bright royal", "hyper royal", "university blue", "estate blue",
        "diffused blue", "dutch blue", "mazarine", "dress blue", "peacoat", "new navy",
        "team navy", "nb navy", "shadow navy", "armoury navy", "armory navy",
        "collegiate navy", "ink", "inkwell", "legend ink", "blue void", "deep sea",
        "deep navy", "deep blue", "thunder blue", "steel blue", "blue slate",
        "slate blue", "blue stone", "bluestone", "dark blue", "navy blue", "chambray",
        "horizon", "photo blue", "light photo blue", "solid cape blue", "cape blue",
        "lucid blue", "night indigo", "carbon midnight", "faded indigo", "blue topaz",
        "capri", "danube", "arona", "bluefin", "blue shadow", "wham blue",
        "aurora ink", "preloved ink", "legink", "glacier blue", "dark petrol",
        "petrol blue", "washed midnight", "blue beyond", "lets scuba", "let's scuba",
        "scuba", "tradewinds", "abimes", "celeste", "blue opal", "world indigo",
        "blue spark", "dawn sky", "dark foggy blue", "blue frost", "blue cendre",
        "classic blue", "pure blue", "vibrant blue", "open air blue", "bluebell",
        "bellwether blue", "phoenix blue", "moonlit blue", "thrift blue",
        "blue dusk", "soft blue", "faded blue", "sun faded blue", "whisper blue",
        "horizon blue", "kingfisher blue", "vintage tint", "salt lake",
        "skywriting", "spring lake", "longbay", "ocean cavern", "shadow rinse",
    ],
    red: [
        "red", "burgundy", "maroon", "wine", "cherry", "crimson", "scarlet", "ruby",
        "racer red", "university red", "pure ruby", "better scarlet", "victory crimson",
        "shadow red", "fire", "flame", "lava", "goji", "tomato", "berry red", "poppy",
        "rosewood", "henna", "paprika", "silt red", "pomegranate", "syrah", "merlot",
        "bordeaux", "bordo", "oxblood", "garnet", "currant", "zinfandel", "sangria",
        "tawny port", "cranberry", "corrida", "rouge", "urgent red", "rose red",
        "vivid red", "shocking red", "red flame", "cabernet", "aurora ruby",
        "classic red", "bright red", "poppy red", "fiery red", "goji berry",
        "port royale",
    ],
    green: [
        "green", "olive", "sage", "mint", "forest green", "forest-green",
        "hunter green", "army green", "emerald", "lime", "moss", "kaki", "military",
        "pine", "fir", "evergreen", "laurel", "thyme", "oregano", "eucalyptus",
        "bay leaf", "artichoke", "fennel", "celery", "pistachio", "matcha", "avocado",
        "cactus", "fern", "algae", "algal", "seagrass", "jade", "malachite",
        "lily pad", "lilypad", "waterlily", "bicoastal", "serpentine", "conifer",
        "cypress", "juniper", "balsam", "loden", "duffel", "duffle", "kalamata",
        "tapenade", "taiga", "field green", "terrain", "garden green", "leaf green",
        "bamboo", "apple green", "neon green", "cyber green", "hyper green",
        "green strike", "chlorophyll", "oil green", "dark olive", "olive drab",
        "olive strata", "cargo khaki", "khaki green",
        "honeydew", "grape leaf", "deep cypress", "cypress", "lima", "myrtle",
        "duck green", "green terrain", "terrain", "algal green", "algal", "olivine",
        "pea pod", "sinople", "marsh green", "mantis green", "jade tint", "jade green",
        "lichen", "elm", "twig green", "arden green", "rack green", "camper green",
        "sulphur spring green", "aloha green", "silver green", "linen green", "celadon",
        "black sage", "black sage green", "fennel seed", "kambaba", "sagebrush",
        "white sage", "dark forest", "fatigue", "heathered fatigue", "grass green",
    ],
    beige: [
        "beige", "taupe", "stone", "sand", "light khaki", "toasted coconut", "beech",
        "greige", "mushroom", "porcini", "shiitake", "shitake", "cardboard", "natural",
        "canvas", "linen", "oatmeal", "oat", "wheat", "straw", "raffia", "rattan",
        "sandstone", "warm sand", "sanddrift", "dune", "desert", "parsnip", "cornstalk",
        "putty", "biscotti", "biscuit", "eggnog", "almond", "sesame", "flax",
        "quicksand", "silt", "stucco", "angora", "shell beige", "crystal sand",
        "cavern", "bungee cord", "brindle", "chinchilla", "porcini taupe",
        "khaki", "classic khaki", "smooth khaki", "trench coat khaki",
        "khaki stone", "deep sand", "fair", "nude", "delicate nude", "snake taupe",
        "peyote", "turtledove", "brazilian sand", "canvas tan", "soft sand",
        "sparkled beige", "heathered tan", "heather beech", "heathered oatmeal",
        "heathered oat", "heather oatmeal", "heather taupe", "heather beige",
    ],
    camel: [
        "camel", "tan", "camel brown", "light brown", "warm beige", "light camel",
        "dark camel", "british tan", "light british tan", "tawny", "toasted tan",
    ],
    brown: [
        "brown", "mocha", "chocolate", "coffee", "caramel", "cognac", "rust brown",
        "espresso", "moka", "mocca", "cocoa", "cappuccino", "latte", "toffee",
        "butterscotch", "honey", "golden brown", "chestnut", "walnut", "hazel",
        "hazelnut", "mahogany", "tobacco", "cinnamon", "ginger", "maple", "oak",
        "wood", "cedar", "bark", "acorn", "fawn", "truffle", "umber", "earth brown",
        "saddle brown", "carob", "pecan", "praline", "sepia", "cork",
        "syrup", "americano", "briquette", "cob", "dark mahogany", "preloved brown",
        "tiger's eye", "tigereye", "gum", "toasty toffee", "costa riche",
        "mink brown", "dark tan", "light chocolate", "affogato", "rum",
        "burnt sugar", "coffee bean",
    ],
    purple: [
        "purple", "violet", "plum", "lavender", "lilac", "mauve", "grape", "orchid",
        "iris", "amethyst", "wisteria", "eggplant", "aubergine", "ube", "raisin",
        "mulberry", "hyacinth", "grapeberry", "mystic purple", "grape ice",
        "alpine plum", "violet tone", "dark iris", "ice lavender", "burnished lilac",
    ],
    pink: [
        "pink", "blush", "fuchsia", "fuschia", "fushia", "fuhsia", "magenta",
        "rose", "hot pink", "dusty pink", "dusty rose", "salmon", "coral pink",
        "guava", "hibiscus", "strawberry", "raspberry", "bubblegum", "taffy",
        "peony", "carnation", "flamingo", "aster", "baby pink", "pale pink",
        "light pink", "clear pink", "bliss pink", "glow pink", "elemental pink",
        "vivid pink", "neon pink", "rose gold", "skin", "bridal rose",
        "blushbaby", "cold pink", "tea rose", "ancient rose", "body rose",
        "rose parade", "rebellious rose", "fiery pink", "bisou", "french bisou",
        "sky pink", "rose quartz", "tourmaline pink", "neutral rose", "boss pink",
        "reseda pink", "toasted rose", "chewing gum pink", "matte bright pink",
        "whisper pink", "rose dusk", "soft rose", "petal pink", "light rose",
    ],
    yellow: [
        "yellow", "mustard", "golden", "gold", "lemon", "canary", "butter", "banana",
        "corn", "sunflower", "dandelion", "turmeric", "ochre", "citrine", "champagne",
        "honey gold", "lucid lemon", "solar yellow", "volt", "barely volt", "limelight",
        "minions yellow", "powder yellow", "yellow sizzle", "acidity", "flashy yellow",
        "crew yellow", "willo", "yzw", "banana crepe", "aged brass", "brass",
        "multigold", "golden palm",
    ],
    orange: [
        "orange", "rust", "peach", "coral", "burnt orange", "terracotta", "terra cotta",
        "amber", "tangerine", "papaya", "mango", "pumpkin", "kumquat", "marmalade",
        "mandarin", "clementine", "apricot", "copper", "ember", "sunrise", "sunset",
        "afterglow", "carrot", "tomato orange", "soft orange", "burnt sunrise",
        "semi coral", "sunkiss", "sunbasque", "ember glow", "bergamotto", "soho sizzle",
    ],
    teal: [
        "teal", "turquoise", "aqua", "cyan", "peacock", "acqua", "aquaverde",
        "aquamarine", "seafoam", "sea foam", "water green", "watergreen", "sea green",
        "tidal teal", "legacy teal", "preloved teal", "real teal", "deep turquoise",
        "magic aqua", "deepest aqua", "aquarius", "aquarius blue", "reef", "pool",
        "blue topaz",
    ],
    multicolor: [
        "multicolor", "multi color", "multi-color", "multicolour", "colour block",
        "color block", "printed", "pattern", "multi", "mix", "mixed", "assorted",
        "rainbow", "print", "camo", "camouflage", "leopard", "zebra", "tie dye",
        "tie-dye", "plaid", "gingham", "stripe", "herringbone", "floral", "hearts",
        "confetti", "ombre", "gradient", "marble", "aop", "allover", "check", "dots",
        "jacquard", "diagonal jacquard", "unicorn star", "multi stripe", "multi-colored",
        "multi coloured", "dreamy geo combo", "geo combo",
    ],
};
const COLOR_COMMON_MISSPELLINGS = {
    fuschia: "fuchsia",
    fushia: "fuchsia",
    fuhsia: "fuchsia",
    fichia: "fuchsia",
    fucsia: "fuchsia",
    fluxia: "fuchsia",
    magentaa: "magenta",
    biege: "beige",
    begie: "beige",
    bordeuax: "bordeaux",
    bordeax: "bordeaux",
    burgendy: "burgundy",
    antracite: "anthracite",
    antrasite: "anthracite",
    antrasit: "anthracite",
    anthracide: "anthracite",
    antractic: "anthracite",
    antra: "anthracite",
    whie: "white",
    whote: "white",
    whhite: "white",
    blk: "black",
    blak: "black",
    balck: "black",
    siliver: "silver",
    sliver: "silver",
    metalic: "metallic",
    caml: "camel",
    tumeric: "turmeric",
    drk: "dark",
    dk: "dark",
    lt: "light",
    offwhite: "off white",
    wht: "white",
    nvy: "navy",
};
const NON_COLOR_VALUE_RE = /^(?:null|none|n\/a|na|no photos?|standard|all hair type|kids?|short|long|regular|tall|one|m|s|xs|xl|2xl|3xl|4xl|5xl|l|\d+(?:\.\d+)?(?:\s?["”]|(?:\s?in(?:seam)?)|\s?eu|\s?ml)?|\d+[a-z]\d+.*)$/i;
const COLOR_NOISE_WORDS = new Set([
    "product", "code", "shade", "universal", "medium", "deep", "light", "dark",
    "mini", "full", "size", "mascara", "hydrator", "spf", "edition", "wash", "washed",
    "garment", "dyed", "heathered", "heather", "chine", "melange", "metallic", "suede",
    "plaid", "gingham", "stripe", "striped", "jacquard", "print", "printed", "allover",
    "twist", "grid", "block", "combo", "fun", "product", "code",
]);
for (const word of [
    "mirror", "lens", "lenses", "frame", "strap", "with", "style", "item", "wordmark",
    "composition", "abstract", "heritage", "vintage", "classic", "team", "logo",
    "logos", "label", "model", "collaboration", "supplier", "colour", "color",
]) {
    COLOR_NOISE_WORDS.add(word);
}
const EXTRA_NON_COLOR_VALUE_RE = /^(?:adult|youth|men|women|boys?|girls?|slim|straight|athletic|bikini|force|birthday|congratulation|usa|no pocket|pocket|ankle|thong|one(?:\s+size(?:\s+for\s+(?:kids?|men|women|youth|adult))?)?|colors?\s+can\s+be\s+customi[sz]ed|supplier\s+colou?r|[ml]\/?[xl]|xs\/s|s\/m|m\/l|l\/xl|xl\/2xl|2xs\/xs|xl\/rg|l\/rg|m\/rg|xxxs|ns|w\d+\s*[-/]\s*l\d+|\d+w\s*[-/]\s*\d+l|\d+(?:\.\d+)?\s*(?:cm|w\s*cm|oz|ml|eu|eeu|l)|\d+\s+\d\/\d\s*eu|\d+\s*[-/]\s*\d+(?:\s*(?:years?|yrs?|cm|in|inseam|eu))?|\d+\s*(?:years?|yrs?)|\d{2,3}\s*[a-z]{1,2}|[0-9]{2,3}[a-z]?)$/i;
function normalizeRawColorString(raw) {
    return String(raw !== null && raw !== void 0 ? raw : "")
        .toLowerCase()
        .replace(/&amp;?/g, " ")
        .replace(/[Â‎]/g, " ")
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .replace(/\bmetalic\b/g, "metallic")
        .replace(/\bsiliver\b|\bsliver\b/g, "silver")
        .replace(/\bwhie\b|\bwhote\b|\bwhhite\b/g, "white")
        .replace(/\bblak\b|\bbalck\b/g, "black")
        .replace(/\bbegie\b|\bbiege\b/g, "beige")
        .replace(/\bfushia\b|\bfuschia\b|\bfichia\b|\bfucsia\b|\bfluxia\b/g, "fuchsia")
        .replace(/\banthracide\b|\bantracite\b|\bantrasit(?:e)?\b|\bantractic\b/g, "anthracite")
        .replace(/\bbordeax\b|\bbordeuax\b|\bburgendy\b/g, "bordeaux")
        .replace(/\bd[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy)\b/g, "dark $1")
        .replace(/\bl[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy)\b/g, "light $1")
        .replace(/\blt[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy|pink|mint|lilac)\b/g, "light $1")
        .replace(/\bdrk[.\s-]*(blue|grey|gray|green|brown|beige|purple|navy)\b/g, "dark $1")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isNonColorValue(raw) {
    const value = normalizeRawColorString(raw);
    if (!value)
        return true;
    if (COLOR_NOISE_WORDS.has(value))
        return true;
    if (hasKnownColorCue(value))
        return false;
    const withoutLeadingCode = value
        .replace(/^(?:[a-z]{1,4}\s*)?\d+[a-z0-9]*\s+/, "")
        .trim();
    if (withoutLeadingCode && withoutLeadingCode !== value && hasKnownColorCue(withoutLeadingCode)) {
        return false;
    }
    return NON_COLOR_VALUE_RE.test(value) || EXTRA_NON_COLOR_VALUE_RE.test(value);
}
const COLOR_ALIAS_TO_CANONICAL = (() => {
    const map = new Map();
    for (const [canonical, aliases] of Object.entries(exports.COLOR_CANONICAL_ALIASES)) {
        map.set(canonical, canonical);
        for (const alias of aliases)
            map.set(alias.toLowerCase(), canonical);
    }
    return map;
})();
const EXACT_COLOR_CANONICAL_OVERRIDES = {
    pelican: "white",
    pepper: "gray",
};
function hasKnownColorCue(raw) {
    const key = normalizeRawColorString(raw)
        .replace(/["â€œâ€'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!key || COLOR_NOISE_WORDS.has(key))
        return false;
    if (EXACT_COLOR_CANONICAL_OVERRIDES[key])
        return true;
    if (COLOR_ALIAS_TO_CANONICAL.has(key))
        return true;
    for (const alias of COLOR_ALIAS_TO_CANONICAL.keys()) {
        if (alias.length < 3)
            continue;
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`).test(key))
            return true;
        if (alias.length >= 5 && key.includes(alias))
            return true;
    }
    return false;
}
function exactAliasCanonical(raw) {
    var _a, _b;
    const key = normalizeRawColorString(raw)
        .replace(/["â€œâ€'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return key
        ? (_b = (_a = EXACT_COLOR_CANONICAL_OVERRIDES[key]) !== null && _a !== void 0 ? _a : COLOR_ALIAS_TO_CANONICAL.get(key)) !== null && _b !== void 0 ? _b : null
        : null;
}
function hasCompositeColorSeparator(raw) {
    return /[\/,&+|]/.test(String(raw !== null && raw !== void 0 ? raw : "")) || /\b(?:and|with)\b/i.test(String(raw !== null && raw !== void 0 ? raw : ""));
}
const COLOR_BUCKET_TO_CANONICAL = {
    black: "black",
    white: "white",
    gray: "gray",
    blue: "blue",
    green: "green",
    red: "red",
    pink: "pink",
    purple: "purple",
    yellow: "yellow",
    orange: "orange",
    brown: "brown",
    teal: "teal",
    multicolor: "multicolor",
};
const GROUP_KEYWORD_HINTS = {
    white: [
        "bone", "alabaster", "porcelain", "vanilla", "ivory", "cream", "ecru", "off", "snow", "milk",
        "pearl", "eggshell", "chalk", "linen", "pale", "cloud", "frost", "buttermilk", "oat",
        "beech", "birch", "parchment", "flour", "crema", "coconut", "whipped cream", "pelican",
    ],
    gray: [
        "graphite", "slate", "steel", "tungsten", "anthracite", "charcoal", "ash", "smoke", "mist",
        "silver", "pewter", "stone", "granite", "iron", "lead", "fog", "drizzle", "carbon",
    ],
    black: [
        "black", "noir", "onyx", "jet", "ebony", "caviar", "ink", "raven", "midnight", "obsidian",
    ],
    blue: [
        "navy", "blue", "indigo", "denim", "cobalt", "azure", "sky", "ocean", "marine", "royal",
        "sapphire", "teal blue", "lapis", "aqua blue", "turquin", "ultramarine", "chambray",
        "atlantic", "sea glass", "spring lake", "longbay", "skywriting",
        "midnight", "inkwell", "ocean cavern", "estate blue", "ray blue",
    ],
    green: [
        "green", "olive", "kalamata", "moss", "sage", "mint", "forest", "leaf", "laurel", "thyme",
        "fennel", "kiwi", "emerald", "hunter", "army", "seagrass", "chlorophyll", "balsam",
        "scarab", "lily pad", "tapenade", "oregano", "eucalyptus", "leek", "pine", "juniper",
        "agave", "bay leaf", "artichoke", "field", "waterlily", "celadon",
    ],
    brown: [
        "brown", "camel", "tan", "beige", "taupe", "khaki", "cocoa", "mocha", "coffee", "espresso",
        "caramel", "cognac", "chestnut", "walnut", "hazel", "sand", "sahara", "toffee", "umber",
        "mahogany", "russet", "biscuit", "parchment", "canvas", "raffia", "peyote", "acorn",
        "truffle", "nutmeg", "ginger", "ochre", "earth", "stone", "desert",
        "tiger's eye", "tigereye", "brandy", "aged brass", "toasted coconut", "toasted almond",
        "russet", "farro", "clay", "cider", "fudge", "latte", "cappuccino", "coffee bean",
        "walnut", "wood", "cedarwood", "castagna", "moraine", "nutria",
    ],
    red: [
        "red", "burgundy", "bordeaux", "bordo", "maroon", "wine", "crimson", "scarlet", "ruby", "cherry",
        "sangria", "oxblood", "claret", "tomato", "cinnabar", "vermilion", "brick", "merlot",
    ],
    pink: [
        "pink", "rose", "blush", "fuchsia", "magenta", "mauve", "peony", "berry", "raspberry",
        "bubblegum", "peachy", "nude", "dusty rose", "cotton candy", "lavaliere",
    ],
    purple: [
        "purple", "violet", "lilac", "lavender", "plum", "orchid", "aubergine", "amethyst", "grape",
        "wisteria",
    ],
    yellow: [
        "yellow", "gold", "mustard", "lemon", "canary", "butter", "banana", "sun", "amberlight",
        "dandelion", "corn", "citrine",
    ],
    orange: [
        "orange", "coral", "peach", "apricot", "terracotta", "rust", "tangerine", "papaya", "carrot",
        "amber", "cantaloupe",
    ],
    teal: [
        "teal", "turquoise", "aqua", "cyan", "peacock", "seafoam", "water", "lagoon", "aquarius",
        "kambaba", "deep sea", "undersea",
    ],
    multicolor: [
        "multi", "multico", "tie dye", "tie-dye", "print", "pattern", "plaid", "gingham", "stripes",
        "zebra", "leopard", "floral", "camo", "color block", "colour block", "mixed",
        "confetti", "moonsplatter", "check", "herringbone",
    ],
};
function inferBucketFromKeywordHints(raw) {
    const s = normalizeRawColorString(raw);
    if (!s)
        return null;
    let best = null;
    let bestScore = 0;
    for (const [bucket, words] of Object.entries(GROUP_KEYWORD_HINTS)) {
        let score = 0;
        for (const w of words) {
            if (!w)
                continue;
            if (s === w)
                score += 4;
            else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s))
                score += 2;
            else if (w.length >= 5 && s.includes(w))
                score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = bucket;
        }
    }
    return bestScore > 0 ? best : null;
}
const COLOR_FAMILY_CLUSTERS = colorCanonical_1.COLOR_FAMILY_GROUPS.map((group) => {
    var _a, _b;
    const normalizedMembers = group
        .map((v) => String(v !== null && v !== void 0 ? v : "").toLowerCase().replace(/[_-]/g, " ").trim())
        .filter(Boolean);
    const representative = (_b = (_a = normalizeColorFamilyRepresentative(normalizedMembers)) !== null && _a !== void 0 ? _a : normalizedMembers[0]) !== null && _b !== void 0 ? _b : "multicolor";
    return { normalizedMembers, representative };
});
function normalizeColorFamilyRepresentative(members) {
    for (const m of members) {
        const canonical = COLOR_ALIAS_TO_CANONICAL.get(m);
        if (canonical)
            return canonical;
    }
    return null;
}
function inferColorFromFamilyCluster(raw) {
    const key = normalizeRawColorString(raw)
        .replace(/["“”'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!key)
        return null;
    let bestColor = null;
    let bestScore = 0;
    for (const cluster of COLOR_FAMILY_CLUSTERS) {
        let score = 0;
        for (const member of cluster.normalizedMembers) {
            if (!member)
                continue;
            if (key === member)
                score += 4;
            else if (member.length >= 5 && key.includes(member))
                score += 2;
            else {
                const words = member.split(" ").filter(Boolean);
                for (const w of words) {
                    if (w.length < 3)
                        continue;
                    if (COLOR_NOISE_WORDS.has(w))
                        continue;
                    if (new RegExp(`\\b${w}\\b`).test(key))
                        score += 1;
                }
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestColor = cluster.representative;
        }
    }
    return bestScore > 0 ? bestColor : null;
}
/**
 * Assign every raw DB color value to a coarse color group.
 * Used for clustering/auditing noisy merchant values.
 */
function inferColorGroupFromRaw(raw) {
    var _a, _b, _c;
    if (!raw)
        return "unknown";
    const source = normalizeRawColorString(raw)
        .replace(/["“”'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!source || isNonColorValue(source))
        return "unknown";
    const isComposite = hasCompositeColorSeparator(String(raw));
    const exact = !isComposite ? exactAliasCanonical(source) : null;
    if (exact) {
        return (_a = (0, colorCanonical_1.coarseColorBucket)(exact)) !== null && _a !== void 0 ? _a : "unknown";
    }
    const candidates = [];
    const addCandidate = (token) => {
        var _a, _b;
        const c = String(token !== null && token !== void 0 ? token : "").trim();
        if (!c)
            return;
        candidates.push(c);
        const normalized = (_b = (_a = normalizeColorToken(c)) !== null && _a !== void 0 ? _a : inferColorFromFamilyCluster(c)) !== null && _b !== void 0 ? _b : c;
        const bucket = (0, colorCanonical_1.coarseColorBucket)(normalized);
        if (bucket)
            candidates.push(bucket);
    };
    if (!isComposite)
        addCandidate(source);
    const parts = source
        .replace(/\band\b/g, ",")
        .replace(/\\/g, "/")
        .split(/[\/,&+|,-]/g)
        .map((s) => s.trim())
        .filter(Boolean);
    for (const p of parts) {
        if (isNonColorValue(p))
            continue;
        if (COLOR_NOISE_WORDS.has(p))
            continue;
        if (/^\d+([.\s]\d+)?$/.test(p))
            continue;
        addCandidate(p);
        const words = p.split(/\s+/g).filter(Boolean);
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            if (/^(?:[a-z]{1,4}\d+|\d+[a-z]{1,4})$/i.test(w))
                continue;
            if (COLOR_NOISE_WORDS.has(w))
                continue;
            addCandidate(w);
            if (i < words.length - 1)
                addCandidate(`${w} ${words[i + 1]}`);
        }
    }
    const votes = new Map();
    for (const token of candidates) {
        const bucket = (0, colorCanonical_1.coarseColorBucket)(token);
        if (!bucket)
            continue;
        votes.set(bucket, ((_b = votes.get(bucket)) !== null && _b !== void 0 ? _b : 0) + 1);
    }
    if (votes.size === 0) {
        const hinted = inferBucketFromKeywordHints(source);
        return (_c = hinted) !== null && _c !== void 0 ? _c : "unknown";
    }
    let winner = "unknown";
    let maxVotes = -1;
    for (const [bucket, count] of votes.entries()) {
        if (count > maxVotes) {
            maxVotes = count;
            winner = bucket;
        }
    }
    if (winner === "unknown") {
        const hinted = inferBucketFromKeywordHints(source);
        if (hinted)
            return hinted;
    }
    return winner;
}
function normalizeColorToken(raw) {
    var _a;
    if (!raw)
        return null;
    const keyBase = normalizeRawColorString(raw)
        .replace(/["“”'`]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!keyBase || isNonColorValue(keyBase))
        return null;
    const key = (_a = COLOR_COMMON_MISSPELLINGS[keyBase]) !== null && _a !== void 0 ? _a : keyBase;
    const exactOverride = EXACT_COLOR_CANONICAL_OVERRIDES[key];
    if (exactOverride)
        return exactOverride;
    const direct = COLOR_ALIAS_TO_CANONICAL.get(key);
    if (direct)
        return direct;
    // Phrase fallback for compound merchant values like "mid wash denim".
    // Prefer explicit color words first, then infer denim family as blue.
    const hasWord = (w) => new RegExp(`\\b${w}\\b`).test(key);
    if (key.includes("denim")) {
        if (hasWord("black"))
            return "black";
        if (hasWord("white") || key.includes("off white") || key.includes("off-white"))
            return "white";
        if (hasWord("gray") || hasWord("grey") || hasWord("charcoal"))
            return "gray";
        return "blue";
    }
    // Generic fallback: if a known alias appears as a whole word/phrase inside
    // the value, resolve to that canonical color.
    for (const [alias, canonical] of COLOR_ALIAS_TO_CANONICAL.entries()) {
        if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(key)) {
            return canonical;
        }
    }
    // Family-cluster fallback for noisy merchant strings.
    const clustered = inferColorFromFamilyCluster(key);
    if (clustered)
        return clustered;
    return null;
}
/**
 * Parse noisy DB color strings into canonical color tokens.
 * Handles formats like "WHITE / NAVY BLUE", "Black Plaid", "CN 58 - Honey", etc.
 */
function normalizeColorTokensFromRaw(raw) {
    if (!raw)
        return [];
    const source = normalizeRawColorString(raw);
    if (!source || isNonColorValue(source))
        return [];
    const isComposite = hasCompositeColorSeparator(String(raw));
    const exact = !isComposite ? exactAliasCanonical(source) : null;
    if (exact)
        return [exact];
    const out = [];
    const add = (token) => {
        var _a;
        const norm = (_a = normalizeColorToken(token)) !== null && _a !== void 0 ? _a : inferColorFromFamilyCluster(token);
        if (norm && !out.includes(norm))
            out.push(norm);
    };
    // 1) Whole-phrase attempt first for values like "mid wash denim".
    if (!isComposite)
        add(source);
    // 2) Split composite merchant formats.
    const parts = source
        .replace(/\band\b/g, ",")
        .replace(/\\/g, "/")
        .split(/[\/,&+|,-]/g)
        .map((s) => s.trim())
        .filter(Boolean);
    for (const p of parts) {
        if (isNonColorValue(p))
            continue;
        if (COLOR_NOISE_WORDS.has(p))
            continue;
        if (/^\d+([.\s]\d+)?$/.test(p))
            continue;
        add(p);
        // 3) Token-level fallback for noisy chunks ("khaki green", "grey chine", "flashy yellow").
        const words = p.split(/\s+/g).filter(Boolean);
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            if (/^(?:[a-z]{1,4}\d+|\d+[a-z]{1,4})$/i.test(w))
                continue;
            if (COLOR_NOISE_WORDS.has(w))
                continue;
            add(w);
            if (i < words.length - 1)
                add(`${w} ${words[i + 1]}`);
        }
    }
    if (out.length === 0) {
        const group = inferColorGroupFromRaw(source);
        const canonical = COLOR_BUCKET_TO_CANONICAL[group];
        if (canonical)
            out.push(canonical);
    }
    return out;
}
function expandColorTermsForFilter(color) {
    var _a, _b;
    const canonical = (_a = normalizeColorToken(color)) !== null && _a !== void 0 ? _a : color.toLowerCase();
    const aliases = (_b = exports.COLOR_CANONICAL_ALIASES[canonical]) !== null && _b !== void 0 ? _b : [canonical];
    const out = new Set([canonical, ...aliases.map((a) => a.toLowerCase())]);
    return [...out];
}
