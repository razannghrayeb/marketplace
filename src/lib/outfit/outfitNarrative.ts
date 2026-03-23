/**
 * LLM outfit narrative + per-product reasons (with Redis cache + template fallback).
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getRedis, isRedisAvailable } from "../redis";
import { resolveGeminiGenerationModel } from "../prompt/gemeni";
import type { Product, ProductCategory, RecommendedProduct, StyleProfile, StyleRecommendation } from "./completestyle";

export interface OutfitNarrative {
  narrative: string;
  productReasons: Record<number, string>;
  generatedBy: "llm" | "template";
}

const CACHE_PREFIX = "outfit_narrative:";
const CACHE_TTL_SEC = 86400;

function hashStyleProfile(style: StyleProfile): string {
  const raw = JSON.stringify({
    o: style.occasion,
    a: style.aesthetic,
    s: style.season,
    f: style.formality,
    c: style.colorProfile.primary,
    t: style.colorProfile.type,
  });
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function buildTemplateNarrative(
  product: Product,
  category: ProductCategory,
  style: StyleProfile,
  recommendations: StyleRecommendation[],
): OutfitNarrative {
  const categoryName = category.replace(/_/g, " ");
  const color = style.colorProfile.primary;
  let narrative = `For your ${color !== "neutral" ? color + " " : ""}${categoryName}`;
  narrative += ` (${style.occasion}, ${style.aesthetic}).`;
  const essentials = recommendations.filter((r) => r.priority === 1);
  if (essentials.length > 0) {
    narrative += ` Start with ${essentials.map((e) => e.category).join(", ")}.`;
  }
  const productReasons: Record<number, string> = {};
  for (const rec of recommendations) {
    for (const p of rec.products) {
      productReasons[p.id] = rec.reason.slice(0, 80);
    }
  }
  return { narrative, productReasons, generatedBy: "template" };
}

function parseJsonFromLlm(text: string): { narrative?: string; productReasons?: Record<string, string> } {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return {};
  }
}

async function callLlmJson(systemPrompt: string, userPrompt: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.35,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: resolveGeminiGenerationModel(),
      systemInstruction: systemPrompt,
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    });
    return result.response.text();
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }

  throw new Error("No LLM API key configured");
}

export async function generateOutfitNarrativeV2(params: {
  seedProduct: Product;
  detectedCategory: ProductCategory;
  style: StyleProfile;
  recommendations: StyleRecommendation[];
  ownedSummaries?: string[];
}): Promise<OutfitNarrative> {
  const fallback = buildTemplateNarrative(
    params.seedProduct,
    params.detectedCategory,
    params.style,
    params.recommendations,
  );

  try {
    const topPicks: Array<{ id: number; title: string; color?: string; bucket: string }> = [];
    for (const rec of params.recommendations) {
      const p = rec.products[0];
      if (p) {
        topPicks.push({
          id: p.id,
          title: p.title,
          color: p.color,
          bucket: rec.category,
        });
      }
    }

    const systemPrompt = `You are a personal stylist in a fashion shopping app. Write specific, warm copy.
Rules:
- Reference the seed product's color/name when known.
- narrative: 2-3 sentences max.
- productReasons: keys are string product ids; values max 12 words; concrete styling reason (not "matches well").
- Return ONLY valid JSON: {"narrative":"...","productReasons":{"123":"..."}}`;

    let userPrompt = `Seed: "${params.seedProduct.title}"${params.seedProduct.color ? `, color: ${params.seedProduct.color}` : ""}
Category: ${params.detectedCategory}. Style: ${params.style.occasion}, ${params.style.aesthetic}, formality ${params.style.formality}/10.
Top picks per bucket:
${topPicks.map((t) => `- id ${t.id} | ${t.bucket} | ${t.title}${t.color ? ` (${t.color})` : ""}`).join("\n")}`;
    if (params.ownedSummaries?.length) {
      userPrompt += `\nUser already owns: ${params.ownedSummaries.join("; ")}. Mention one if it completes the outfit naturally.`;
    }

    const raw = await callLlmJson(systemPrompt, userPrompt);
    const parsed = parseJsonFromLlm(raw);
    if (!parsed.narrative || typeof parsed.narrative !== "string") {
      return fallback;
    }
    const productReasons: Record<number, string> = { ...fallback.productReasons };
    if (parsed.productReasons && typeof parsed.productReasons === "object") {
      for (const [k, v] of Object.entries(parsed.productReasons)) {
        const id = parseInt(k, 10);
        if (Number.isFinite(id) && typeof v === "string" && v.trim()) {
          productReasons[id] = v.trim().slice(0, 120);
        }
      }
    }
    return {
      narrative: parsed.narrative.trim(),
      productReasons,
      generatedBy: "llm",
    };
  } catch (e) {
    console.warn("[outfitNarrative] LLM failed, using template:", e);
    return fallback;
  }
}

export async function generateOutfitNarrativeWithCache(params: {
  seedProduct: Product;
  detectedCategory: ProductCategory;
  style: StyleProfile;
  recommendations: StyleRecommendation[];
  ownedSummaries?: string[];
}): Promise<OutfitNarrative> {
  const pid = params.seedProduct.id;
  const h = hashStyleProfile(params.style);
  const key = `${CACHE_PREFIX}${pid}:${h}`;

  if (isRedisAvailable()) {
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (typeof cached === "string" && cached.length > 0) {
          const parsed = JSON.parse(cached) as OutfitNarrative;
          if (parsed?.narrative && parsed.generatedBy) return parsed;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const result = await generateOutfitNarrativeV2(params);

  if (isRedisAvailable() && result.generatedBy === "llm") {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setex(key, CACHE_TTL_SEC, JSON.stringify(result));
      } catch {
        /* ignore */
      }
    }
  }

  return result;
}

export function applyNarrativeToProducts(
  recommendations: StyleRecommendation[],
  narrative: OutfitNarrative,
): void {
  for (const rec of recommendations) {
    for (const p of rec.products) {
      const reason = narrative.productReasons[p.id];
      if (reason) {
        p.matchReasons = [reason, ...(p.matchReasons || []).filter((r) => r !== reason)].slice(0, 4);
      }
    }
  }
}
