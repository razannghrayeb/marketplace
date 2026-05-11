/**
 * Weather Intelligence — anchor-driven thermal model.
 *
 * The legacy `scoreWeatherCompatibility` uses only a 4-bucket season label
 * ("spring/summer/fall/winter/all-season") and detects warm/cool cues with two
 * regex sets. That misses obvious mistakes — e.g. recommending a fleece with
 * a tank-top anchor because both sit in "all-season".
 *
 * This module:
 *   1. Infers a real anchor temperature in °C from the anchor garment cues
 *      (linen shorts → ~28°C, wool parka → ~3°C).
 *   2. Assigns each candidate a thermal class with a min/max comfortable °C
 *      band, accounting for material (linen +5, wool/fleece −5).
 *   3. Scores overlap between anchor temp and candidate band, with a graceful
 *      tolerance (±4°C cliff, then steep drop).
 *
 * The module is intentionally heuristic — it falls back to a moderate score
 * when it cannot classify the candidate, so unknown items don't get pushed
 * out of the result set.
 */

import type { StyleProfile } from "./completestyle";

export interface WeatherJudgement {
  /** 0..1 — higher = better thermal/weather fit between anchor and candidate. */
  score: number;
  /** 0..1 — confidence in the classification; low when the candidate can't be classed. */
  confidence: number;
  /** Inferred anchor temperature in °C (from anchor garment cues). */
  anchorTemperatureC: number;
  /** Candidate's comfortable temperature band in °C, if classified. */
  candidateBand?: { minC: number; maxC: number; label: string };
  reason: string;
}

/**
 * Garment thermal classes — broad bands that match how people actually pick
 * what to wear by temperature. The label is exposed in match reasons.
 *
 * Order matters: the first regex match wins, so more specific patterns
 * (parka, swimwear) come before broad ones (jacket, shorts).
 */
interface ThermalClass {
  label: string;
  minC: number;
  maxC: number;
  match: RegExp;
}

const THERMAL_CLASSES: ThermalClass[] = [
  { label: "parka/puffer/heavy coat", minC: -15, maxC: 8,  match: /\b(parka|puffer|down jacket|heavy coat|winter coat|trench coat|overcoat|fur coat|shearling)\b/i },
  { label: "wool/cashmere outerwear", minC: -5,  maxC: 12, match: /\b(wool coat|cashmere coat|tweed coat|peacoat|pea coat)\b/i },
  { label: "knit sweater / heavy knit", minC: -2, maxC: 14, match: /\b(wool sweater|cashmere|chunky knit|cable knit|cable-knit|heavy knit|fleece pullover|fleece jacket|fleece)\b/i },
  { label: "thermal/long johns",       minC: -5,  maxC: 10, match: /\b(thermal|long johns|base layer|heat tech)\b/i },
  { label: "winter boots",             minC: -10, maxC: 12, match: /\b(snow boot|winter boot|fur-lined boot|shearling boot|combat boot|hiking boot|chelsea boot|ugg)\b/i },
  { label: "leather jacket / bomber",  minC: 4,   maxC: 18, match: /\b(leather jacket|biker jacket|moto jacket|bomber|varsity jacket|aviator)\b/i },
  { label: "denim jacket / blazer",    minC: 8,   maxC: 22, match: /\b(denim jacket|jean jacket|blazer|sport coat|tweed blazer|tailored jacket)\b/i },
  { label: "light jacket / windbreaker", minC: 8, maxC: 20, match: /\b(windbreaker|rain jacket|shell jacket|lightweight jacket|anorak|gilet|vest jacket)\b/i },
  { label: "sweatshirt / hoodie",      minC: 5,   maxC: 18, match: /\b(hoodie|sweatshirt|crewneck|pullover|sweat top)\b/i },
  { label: "cardigan",                 minC: 8,   maxC: 22, match: /\b(cardigan|kimono jacket|open knit)\b/i },
  { label: "knit pants / wool pants",  minC: 0,   maxC: 18, match: /\b(wool pant|wool trouser|knit pant|corduroy pant|corduroys|flannel pant)\b/i },
  { label: "leggings / thick tights",  minC: 0,   maxC: 22, match: /\b(legging|leggings|thermal tight|fleece tight)\b/i },
  { label: "jeans / chinos",           minC: 5,   maxC: 26, match: /\b(jeans|denim pant|chinos|chino pants|trouser|trousers|dress pant|cargo pant)\b/i },
  { label: "long-sleeve top",          minC: 8,   maxC: 22, match: /\b(long sleeve|long-sleeve|long sleeves|crew neck tee|crew-neck tee|button down shirt|button-down shirt|oxford shirt|flannel shirt|turtleneck|polo neck|mock neck)\b/i },
  { label: "shirt / blouse",           minC: 12,  maxC: 26, match: /\b(blouse|chiffon top|silk top|button down|button-down|oxford|poplin shirt|dress shirt|formal shirt|shirt dress)\b/i },
  { label: "midi/maxi dress",          minC: 12,  maxC: 28, match: /\b(midi dress|maxi dress|long dress|wrap dress)\b/i },
  { label: "skirt — knee/midi",        minC: 10,  maxC: 26, match: /\b(midi skirt|pencil skirt|knee skirt|a-line skirt|pleated skirt)\b/i },
  { label: "skirt — mini",             minC: 16,  maxC: 32, match: /\b(mini skirt|short skirt|tennis skirt)\b/i },
  { label: "shorts",                   minC: 18,  maxC: 35, match: /\b(short|shorts|bermuda|cargo shorts|denim shorts|biker shorts)\b/i },
  { label: "t-shirt / tee",            minC: 16,  maxC: 32, match: /\b(t-?shirt|tee|graphic tee|crop top|cropped top|short sleeve|short-sleeve)\b/i },
  { label: "tank / sleeveless",        minC: 20,  maxC: 35, match: /\b(tank top|tank|sleeveless|camisole|cami|halter|tube top|spaghetti strap)\b/i },
  { label: "linen / lightweight",      minC: 18,  maxC: 34, match: /\b(linen|gauze|seersucker|chambray top|cheesecloth|tropical weight)\b/i },
  { label: "swimwear / beach",         minC: 22,  maxC: 38, match: /\b(swimsuit|bikini|swimwear|trunks|cover[- ]?up|sarong|board short|rashguard)\b/i },
  { label: "sandals / open shoes",     minC: 18,  maxC: 35, match: /\b(sandal|sandals|flip flop|flip-flop|slide|slides|espadrille|jelly shoes|huaraches)\b/i },
  { label: "boots — fashion",          minC: 0,   maxC: 18, match: /\b(boot|boots|ankle boot|knee boot|riding boot|cowboy boot|combat)\b/i },
  { label: "heels / dressy shoes",     minC: 8,   maxC: 30, match: /\b(heel|heels|pump|pumps|stiletto|stilettos|mule|mules|loafer|loafers|oxford|oxfords|derby|monk strap|flat|flats|ballet flat)\b/i },
  { label: "sneakers",                 minC: 4,   maxC: 32, match: /\b(sneaker|sneakers|trainer|trainers|running shoe|tennis shoe|canvas shoe|skate shoe|basketball shoe)\b/i },
  // Material-only fallbacks
  { label: "wool / cashmere fabric",   minC: -2,  maxC: 14, match: /\b(wool|cashmere|merino|tweed|alpaca|mohair|herringbone)\b/i },
  { label: "knit fabric",              minC: 4,   maxC: 18, match: /\b(knit|knitted|knitwear|jumper|sweater|cardigan)\b/i },
];

/**
 * Materials shift the band slightly. We only apply this when the class was
 * matched generically (e.g. "shirt" matched but description says "linen
 * shirt"); the move is small (±3°C) and bounded.
 */
const MATERIAL_BIAS_C: Array<{ pattern: RegExp; delta: number }> = [
  { pattern: /\b(linen|gauze|seersucker|tropical weight|cool weave)\b/i, delta: 4 },
  { pattern: /\b(cotton|chambray|poplin)\b/i, delta: 1 },
  { pattern: /\b(silk|satin|chiffon)\b/i, delta: 2 },
  { pattern: /\b(wool|cashmere|tweed|alpaca|mohair|merino)\b/i, delta: -5 },
  { pattern: /\b(fleece|sherpa|teddy|fur|shearling)\b/i, delta: -7 },
  { pattern: /\b(thermal|insulated|down-filled|down filled)\b/i, delta: -8 },
];

/** Mid-season default temperatures (°C) when only the label is known. */
const SEASON_BASE_TEMP_C: Record<StyleProfile["season"], number> = {
  spring: 17,
  summer: 28,
  fall: 14,
  winter: 5,
  "all-season": 19,
};

function classifyThermal(text: string): ThermalClass | null {
  for (const c of THERMAL_CLASSES) {
    if (c.match.test(text)) return c;
  }
  return null;
}

function applyMaterialBias(band: { minC: number; maxC: number }, text: string): { minC: number; maxC: number } {
  let delta = 0;
  for (const m of MATERIAL_BIAS_C) {
    if (m.pattern.test(text)) {
      delta += m.delta;
      break; // only one bias to keep it bounded
    }
  }
  if (delta === 0) return band;
  return {
    minC: band.minC + delta,
    maxC: band.maxC + delta,
  };
}

/**
 * Infer an anchor's intended temperature in °C from its title/category/desc.
 * Falls back to the season's base temperature when no garment cue is found.
 */
export function inferAnchorTemperatureC(params: {
  title?: string | null;
  category?: string | null;
  description?: string | null;
  season: StyleProfile["season"];
  /** Optional explicit override (e.g. from user locale weather). */
  explicitTempC?: number;
}): { temperatureC: number; source: "explicit" | "anchor-garment" | "season-default" } {
  if (typeof params.explicitTempC === "number" && Number.isFinite(params.explicitTempC)) {
    return { temperatureC: params.explicitTempC, source: "explicit" };
  }

  const text = `${params.title ?? ""} ${params.category ?? ""} ${params.description ?? ""}`;
  const cls = classifyThermal(text);
  if (cls) {
    const band = applyMaterialBias({ minC: cls.minC, maxC: cls.maxC }, text);
    // Use mid of band as anchor temp
    const mid = (band.minC + band.maxC) / 2;
    // Pull mid toward season's base — keeps results sensible when season is
    // strongly stated by the user but the garment is all-season cotton.
    const seasonBase = SEASON_BASE_TEMP_C[params.season] ?? 19;
    const blended = mid * 0.7 + seasonBase * 0.3;
    return { temperatureC: Math.round(blended), source: "anchor-garment" };
  }

  return { temperatureC: SEASON_BASE_TEMP_C[params.season] ?? 19, source: "season-default" };
}

/**
 * Score how well a candidate's thermal class fits an anchor temperature in °C.
 *
 * - Inside [minC, maxC] of the candidate band → 1.0
 * - Within ±4°C of the band → 0.9 → 0.7 sliding
 * - Within ±8°C → 0.55 → 0.45
 * - Beyond that → 0.25 (heavy item far outside) or 0.35 (light item far outside)
 *
 * If the candidate cannot be classified, returns a moderate fallback score
 * with low confidence so the caller can still rely on legacy weather scoring.
 */
export function scoreWeatherFit(params: {
  anchorTempC: number;
  candidateText: string;
}): WeatherJudgement {
  const cls = classifyThermal(params.candidateText);
  if (!cls) {
    return {
      score: 0.72,
      confidence: 0.2,
      anchorTemperatureC: params.anchorTempC,
      reason: "no thermal classification — defer to legacy weather score",
    };
  }

  const band = applyMaterialBias({ minC: cls.minC, maxC: cls.maxC }, params.candidateText);

  const t = params.anchorTempC;
  let score: number;
  let reason: string;
  if (t >= band.minC && t <= band.maxC) {
    score = 1.0;
    reason = `${cls.label} matches anchor ~${Math.round(t)}°C`;
  } else if (t < band.minC) {
    const gap = band.minC - t;
    if (gap <= 4) { score = 0.82; reason = `${cls.label} is a touch light for ~${Math.round(t)}°C`; }
    else if (gap <= 8) { score = 0.55; reason = `${cls.label} is too light for ~${Math.round(t)}°C`; }
    else { score = 0.32; reason = `${cls.label} is far too light for ~${Math.round(t)}°C`; }
  } else {
    const gap = t - band.maxC;
    if (gap <= 4) { score = 0.78; reason = `${cls.label} is slightly heavy for ~${Math.round(t)}°C`; }
    else if (gap <= 8) { score = 0.5; reason = `${cls.label} is too warm for ~${Math.round(t)}°C`; }
    else { score = 0.22; reason = `${cls.label} is way too heavy for ~${Math.round(t)}°C`; }
  }

  return {
    score,
    confidence: 0.75,
    anchorTemperatureC: t,
    candidateBand: { minC: band.minC, maxC: band.maxC, label: cls.label },
    reason,
  };
}
