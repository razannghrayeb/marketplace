import { generateVertexContentText } from "./googleVertexGenerative";

export type InferredOccasion = "formal" | "semi-formal" | "casual" | "active" | "party" | "beach";

export interface OccasionInferenceAnchor {
  title: string;
  category?: string;
  color?: string;
  styleTokens?: string[];
}

export interface OccasionInferenceResult {
  occasion: InferredOccasion;
  confidence: number;
  reasoning: string;
  source: "llm" | "heuristic";
}

const ALLOWED_OCCASIONS: InferredOccasion[] = ["formal", "semi-formal", "casual", "active", "party", "beach"];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeOccasion(value: string): InferredOccasion | null {
  const v = String(value || "").toLowerCase().trim();
  if (v === "formal") return "formal";
  if (v === "semi-formal" || v === "semiformal" || v === "business") return "semi-formal";
  if (v === "casual") return "casual";
  if (v === "active" || v === "sport") return "active";
  if (v === "party" || v === "date") return "party";
  if (v === "beach" || v === "resort") return "beach";
  return null;
}

function inferOccasionHeuristic(anchors: OccasionInferenceAnchor[]): OccasionInferenceResult {
  const text = anchors
    .map((a) => `${String(a.title || "")} ${String(a.category || "")} ${(a.styleTokens || []).join(" ")}`)
    .join(" ")
    .toLowerCase();

  if (/\b(tuxedo|gown|tie|oxford|dress shoe|blazer|suit|heels?)\b/.test(text)) {
    return { occasion: "formal", confidence: 0.62, reasoning: "formal garment cues", source: "heuristic" };
  }
  if (/\b(office|work|shirt|trouser|loafer|midi|cardigan)\b/.test(text)) {
    return { occasion: "semi-formal", confidence: 0.58, reasoning: "workwear cues", source: "heuristic" };
  }
  if (/\b(sport|athletic|gym|jogger|sneaker|hoodie|activewear)\b/.test(text)) {
    return { occasion: "active", confidence: 0.6, reasoning: "activewear cues", source: "heuristic" };
  }
  if (/\b(beach|swim|sandal|resort|linen short)\b/.test(text)) {
    return { occasion: "beach", confidence: 0.6, reasoning: "beachwear cues", source: "heuristic" };
  }
  if (/\b(sequin|party|night|cocktail|mini dress|clutch)\b/.test(text)) {
    return { occasion: "party", confidence: 0.6, reasoning: "partywear cues", source: "heuristic" };
  }

  return { occasion: "casual", confidence: 0.4, reasoning: "default fallback", source: "heuristic" };
}

function parseLlmJson(raw: string): OccasionInferenceResult | null {
  const s = String(raw || "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(s.slice(start, end + 1)) as {
      occasion?: string;
      confidence?: number;
      reasoning?: string;
    };
    const occasion = normalizeOccasion(parsed.occasion || "");
    if (!occasion) return null;
    const confidence = clamp01(Number(parsed.confidence ?? 0.5));
    const reasoning = String(parsed.reasoning || "LLM inferred").slice(0, 240);
    return { occasion, confidence, reasoning, source: "llm" };
  } catch {
    return null;
  }
}

async function inferOccasionLlm(anchors: OccasionInferenceAnchor[]): Promise<OccasionInferenceResult | null> {
  const items = anchors
    .slice(0, 8)
    .map((a) => {
      const parts = [a.title, a.category, a.color, (a.styleTokens || []).join(" ")].filter(Boolean);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  const prompt = [
    "You are a fashion stylist.",
    "Infer the most likely occasion from these wardrobe items.",
    "Return JSON only.",
    `Allowed occasions: ${ALLOWED_OCCASIONS.join(", ")}`,
    "Schema: {\"occasion\":\"formal|semi-formal|casual|active|party|beach\",\"confidence\":0.0-1.0,\"reasoning\":\"short reason\"}",
    "Items:",
    items,
  ].join("\n");

  const raw = await generateVertexContentText({
    userPrompt: prompt,
    temperature: 0.1,
    maxOutputTokens: 180,
    responseMimeType: "application/json",
  });

  return parseLlmJson(raw);
}

export async function inferOccasion(
  anchors: OccasionInferenceAnchor[],
): Promise<OccasionInferenceResult> {
  const fallback = inferOccasionHeuristic(anchors);
  try {
    const llm = await inferOccasionLlm(anchors);
    if (llm) return llm;
    return fallback;
  } catch {
    return fallback;
  }
}
