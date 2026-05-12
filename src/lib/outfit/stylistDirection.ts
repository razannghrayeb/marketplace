/**
 * Stylist Direction — Gemini-as-stylist.
 *
 * Called once per anchor (per /complete-style request) to ask Vertex Gemini
 * what an experienced fashion stylist would pair with the anchor across each
 * slot. The output is a structured "ideal" spec per slot:
 *
 *   tops:      { keywords: [...], colors: [...], styles: [...] }
 *   bottoms:   { ... }
 *   shoes:     { ... }
 *   bags:      { ... }
 *   outerwear: { ... }
 *   accessories: { ... }
 *
 * Plus a small avoid-list of categories/styles/colors that would clash.
 *
 * The rerank step uses this output as a SOFT signal:
 *   - candidate matches keyword/color/style    → +bonus
 *   - candidate appears in the avoid list      → −penalty
 *
 * No hard reject. No cache (user chose fresh every call). Times out at 6s
 * with a clean fallback to a heuristic spec — the pipeline NEVER blocks on
 * Gemini, and the existing reranker remains the source of truth.
 */

import { generateVertexContentText } from "./googleVertexGenerative";
import type { StyleProfile } from "./completestyle";

export interface SlotIdeals {
  /** Lowercase keyword tokens a stylist would expect ("white shirt", "loafer"). */
  keywords: string[];
  /** Lowercase color names the stylist would steer toward. */
  colors: string[];
  /** Lowercase style/aesthetic tokens ("tailored", "elevated casual"). */
  styles: string[];
}

export interface StylistDirection {
  /** One short sentence summarising the styling direction. */
  rationale: string;
  /** Per-slot ideals — slot keys match the family labels used in rerank. */
  slots: {
    tops?: SlotIdeals;
    bottoms?: SlotIdeals;
    shoes?: SlotIdeals;
    bags?: SlotIdeals;
    outerwear?: SlotIdeals;
    dress?: SlotIdeals;
    accessories?: SlotIdeals;
  };
  /** Things to actively steer the user away from. */
  avoid: {
    keywords?: string[];
    colors?: string[];
    styles?: string[];
    families?: string[];
  };
  /** Where this direction came from. */
  source: "llm" | "heuristic";
}

const SLOT_KEYS = ["tops", "bottoms", "shoes", "bags", "outerwear", "dress", "accessories"] as const;
type SlotKey = typeof SLOT_KEYS[number];

function isVertexConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
}

function lower(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

function safeStringArray(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    const s = lower(v);
    if (!s || s.length > 40 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function parseSlot(value: unknown): SlotIdeals | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const keywords = safeStringArray(obj.keywords);
  const colors = safeStringArray(obj.colors);
  const styles = safeStringArray(obj.styles);
  if (!keywords.length && !colors.length && !styles.length) return undefined;
  return { keywords, colors, styles };
}

function heuristicDirection(anchor: {
  title: string;
  family: string;
  style: StyleProfile;
  color?: string | null;
}): StylistDirection {
  // Lightweight fallback when Gemini is unavailable. Built from existing
  // style metadata so it can never disagree with the rest of the pipeline.
  const occ = anchor.style.occasion;
  const palette = (anchor.style.colorProfile.harmonies?.[0]?.colors || []).slice(0, 4);
  const aesthetic = anchor.style.aesthetic;

  const dressy = occ === "formal" || occ === "semi-formal" || occ === "party";
  const slots: StylistDirection["slots"] = {};

  if (anchor.family !== "tops" && anchor.family !== "dress") {
    slots.tops = {
      keywords: dressy ? ["blouse", "silk top", "shirt"] : ["t-shirt", "shirt", "knit top"],
      colors: palette.length ? palette : ["white", "cream", "black"],
      styles: [aesthetic],
    };
  }
  if (anchor.family !== "bottoms" && anchor.family !== "dress") {
    slots.bottoms = {
      keywords: dressy ? ["tailored trouser", "midi skirt", "straight pant"] : ["jeans", "chinos", "shorts"],
      colors: ["black", "navy", "cream", "olive"],
      styles: [aesthetic],
    };
  }
  if (anchor.family !== "shoes") {
    slots.shoes = {
      keywords: dressy ? ["heel", "loafer", "ankle boot"] : ["sneaker", "loafer", "flat"],
      colors: ["black", "tan", "white", "cream"],
      styles: [aesthetic],
    };
  }
  if (anchor.family !== "bags") {
    slots.bags = {
      keywords: dressy ? ["clutch", "satchel", "structured bag"] : ["crossbody", "tote", "shoulder bag"],
      colors: ["black", "tan", "cream"],
      styles: [aesthetic],
    };
  }
  if (anchor.family !== "outerwear" && anchor.family !== "dress") {
    slots.outerwear = {
      keywords: dressy ? ["blazer", "tailored coat"] : ["denim jacket", "bomber", "cardigan"],
      colors: ["black", "navy", "camel", "cream"],
      styles: [aesthetic],
    };
  }
  slots.accessories = {
    keywords: dressy ? ["minimal jewelry", "leather belt"] : ["watch", "leather belt", "sunglasses"],
    colors: ["gold", "silver", "black", "tan"],
    styles: [aesthetic],
  };

  return {
    rationale: `Heuristic direction for ${anchor.style.occasion} ${aesthetic} look.`,
    slots,
    avoid: {
      keywords: dressy ? ["sports legging", "tracksuit", "graphic tee"] : ["sequin", "tuxedo"],
      families: occ === "active" ? ["dress", "bags"] : [],
    },
    source: "heuristic",
  };
}

function parseGeminiDirection(raw: string): StylistDirection | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const rationale = lower(parsed.rationale).slice(0, 280);
    const slotsRaw = (parsed.slots && typeof parsed.slots === "object") ? parsed.slots as Record<string, unknown> : {};
    const slots: StylistDirection["slots"] = {};
    for (const key of SLOT_KEYS) {
      const slot = parseSlot(slotsRaw[key]);
      if (slot) slots[key] = slot;
    }

    let avoidRaw: Record<string, unknown> = {};
    if (parsed.avoid && typeof parsed.avoid === "object") {
      avoidRaw = parsed.avoid as Record<string, unknown>;
    }
    const avoid = {
      keywords: safeStringArray(avoidRaw.keywords),
      colors: safeStringArray(avoidRaw.colors),
      styles: safeStringArray(avoidRaw.styles),
      families: safeStringArray(avoidRaw.families).filter((f) =>
        ["tops", "bottoms", "shoes", "bags", "outerwear", "dress", "accessories"].includes(f),
      ),
    };

    // Need at least one usable slot — otherwise the LLM didn't actually
    // produce a direction.
    if (Object.keys(slots).length === 0) return null;

    return {
      rationale: rationale || "Gemini-assisted styling direction.",
      slots,
      avoid,
      source: "llm",
    };
  } catch {
    return null;
  }
}

function stylistDirectionTimeoutMs(): number {
  const raw = Number.parseInt(String(process.env.STYLIST_DIRECTION_TIMEOUT_MS || ""), 10);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(250, Math.min(raw, 6000));
  }
  return 1800;
}

/**
 * Ask Gemini what a stylist would pair with the anchor.
 *
 * Always resolves — falls back to heuristic on any error, missing config, or
 * timeout. Latency cap defaults to 1.8s; the rerank step runs other features in the
 * background and joins the result.
 */
export async function getStylistDirection(anchor: {
  title: string;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  color?: string | null;
  family: string;
  style: StyleProfile;
  audienceGender?: string;
  ageGroup?: string;
  /** Optional short-form summaries of items the user already owns; the
   * stylist is told to favour pairings that build outfits around these. */
  wardrobeSummaries?: string[];
}): Promise<StylistDirection> {
  const fallback = heuristicDirection({
    title: anchor.title,
    family: anchor.family,
    style: anchor.style,
    color: anchor.color ?? null,
  });

  if (!isVertexConfigured()) return fallback;

  const anchorBullet =
    `- title: ${anchor.title}\n` +
    (anchor.brand ? `- brand: ${anchor.brand}\n` : "") +
    (anchor.category ? `- catalog category: ${anchor.category}\n` : "") +
    (anchor.color ? `- color: ${anchor.color}\n` : "") +
    `- detected slot: ${anchor.family}\n` +
    `- occasion: ${anchor.style.occasion}\n` +
    `- aesthetic: ${anchor.style.aesthetic}\n` +
    `- season: ${anchor.style.season}\n` +
    `- formality (1-10): ${anchor.style.formality}\n` +
    (anchor.audienceGender ? `- audience: ${anchor.audienceGender}\n` : "") +
    (anchor.ageGroup ? `- age group: ${anchor.ageGroup}\n` : "");

  const otherSlots = SLOT_KEYS.filter((s) => s !== anchor.family).join(", ");

  const wardrobeBlock =
    Array.isArray(anchor.wardrobeSummaries) && anchor.wardrobeSummaries.length > 0
      ? `\nUSER WARDROBE (already owned — favour pairings that build outfits AROUND these items where it makes sense, and avoid suggestions that conflict with them):\n${anchor.wardrobeSummaries.slice(0, 20).join("\n")}\n`
      : "";

  const systemPrompt =
    "You are a senior fashion stylist. For the anchor garment given, decide what real items would complete the outfit per slot.\n" +
    "Rules:\n" +
    "- Think in real outfits, not generic suggestions: a blazer pairs with a tailored trouser and a leather loafer, not 'pants and shoes'.\n" +
    "- Match the anchor's occasion, aesthetic, season, formality, audience, and color undertone.\n" +
    "- Each slot gets 3-6 lowercase keyword tokens, 2-4 color names, 1-3 style tokens.\n" +
    "- Skip slots that don't belong in the outfit (e.g. don't recommend a dress when the anchor is a dress).\n" +
    "- Use 'avoid' to call out colors, styles, families, or keywords that would clash with this anchor.\n" +
    "- Return ONLY valid JSON. No markdown.\n" +
    "Schema:\n" +
    `{\n  "rationale": "one short sentence",\n  "slots": {\n    "tops":      {"keywords":[],"colors":[],"styles":[]},\n    "bottoms":   {"keywords":[],"colors":[],"styles":[]},\n    "shoes":     {"keywords":[],"colors":[],"styles":[]},\n    "bags":      {"keywords":[],"colors":[],"styles":[]},\n    "outerwear": {"keywords":[],"colors":[],"styles":[]},\n    "dress":     {"keywords":[],"colors":[],"styles":[]},\n    "accessories":{"keywords":[],"colors":[],"styles":[]}\n  },\n  "avoid": {"keywords":[],"colors":[],"styles":[],"families":[]}\n}\n` +
    `Available slot keys for "slots": ${SLOT_KEYS.join(", ")}. Available family keys for "avoid.families": ${SLOT_KEYS.join(", ")}.\n` +
    `Anchor sits in slot '${anchor.family}', so style the OTHER slots: ${otherSlots}.`;

  const userPrompt =
    `Anchor:\n${anchorBullet}\n` +
    wardrobeBlock +
    `\nProduce the styling direction now. Each slot's keywords should be REAL garments a stylist would name out loud.`;

  try {
    const raw = await Promise.race([
      generateVertexContentText({
        systemInstruction: systemPrompt,
        userPrompt,
        temperature: 0.25,
        maxOutputTokens: 700,
        responseMimeType: "application/json",
      }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("stylistDirection_timeout")), stylistDirectionTimeoutMs())),
    ]);
    const parsed = parseGeminiDirection(raw);
    if (!parsed) return fallback;
    return parsed;
  } catch (err) {
    // Never block — log at debug only.
    if (process.env.DEBUG_OUTFIT_STYLIST === "1") {
      console.warn("[stylistDirection] Gemini failed, using heuristic:", err);
    }
    return fallback;
  }
}

/**
 * Score how well a candidate aligns with the stylist's ideal for its slot.
 *
 * Returns a number in [-1, +1]:
 *   +1 → strong agreement (keywords/colors/styles all align)
 *    0 → indeterminate / no slot ideal
 *   -1 → directly contradicts the avoid list
 *
 * The rerank step blends this with a small weight to produce a soft boost or
 * a soft penalty, per the user's chosen aggressiveness.
 */
export function scoreAgainstDirection(params: {
  direction: StylistDirection;
  candidateFamily: string;
  candidateText: string;
  candidateColor?: string | null;
}): { score: number; reason: string } {
  const family = lower(params.candidateFamily) as SlotKey;
  const text = lower(params.candidateText);
  const candidateColor = lower(params.candidateColor);

  // Soft penalty: candidate is in an avoid family
  const avoid = params.direction.avoid;
  if (avoid.families?.includes(family)) {
    return { score: -0.6, reason: "stylist flagged this category as a clash" };
  }

  let avoidScore = 0;
  for (const w of avoid.keywords || []) {
    if (w && text.includes(w)) {
      avoidScore -= 0.5;
      break;
    }
  }
  for (const c of avoid.colors || []) {
    if (c && (candidateColor === c || text.includes(c))) {
      avoidScore -= 0.4;
      break;
    }
  }
  for (const s of avoid.styles || []) {
    if (s && text.includes(s)) {
      avoidScore -= 0.3;
      break;
    }
  }
  if (avoidScore <= -0.4) {
    return { score: Math.max(-1, avoidScore), reason: "stylist would avoid this for the anchor" };
  }

  const slot = params.direction.slots[family];
  if (!slot) {
    // No ideal for this slot — return small avoid effect (if any) so we
    // still penalise obvious clashes even when the slot wasn't styled.
    return { score: avoidScore, reason: avoidScore < 0 ? "stylist avoid signal" : "no styling guidance" };
  }

  let positive = 0;
  let hits: string[] = [];

  for (const w of slot.keywords) {
    if (w && text.includes(w)) {
      positive += 0.18;
      hits.push(w);
      if (positive >= 0.5) break;
    }
  }
  for (const c of slot.colors) {
    if (c && (candidateColor === c || text.includes(c))) {
      positive += 0.12;
      hits.push(c);
      if (positive >= 0.7) break;
    }
  }
  for (const s of slot.styles) {
    if (s && text.includes(s)) {
      positive += 0.08;
      hits.push(s);
      if (positive >= 0.85) break;
    }
  }

  const score = Math.max(-1, Math.min(1, positive + avoidScore));
  if (score >= 0.35) {
    return { score, reason: `stylist match: ${hits.slice(0, 3).join(", ")}` };
  }
  if (score <= -0.2) {
    return { score, reason: "partial conflict with stylist direction" };
  }
  return { score, reason: "neutral against stylist direction" };
}
