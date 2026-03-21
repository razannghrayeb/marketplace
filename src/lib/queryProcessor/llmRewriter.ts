/**
 * LLM Rewriter (Fallback)
 * 
 * Constrained LLM rewrite for ambiguous queries.
 * Only called when rule-based corrections fail.
 * 
 * Supports:
 * - OpenAI API (GPT-3.5-turbo/GPT-4)
 * - Anthropic Claude
 * - Local Ollama
 */

import { LLMRewriteRequest, LLMRewriteResponse, ScriptAnalysis } from "./types";
import { config } from "../../config";

// ============================================================================
// Configuration
// ============================================================================

interface LLMConfig {
  provider: "openai" | "anthropic" | "ollama" | "none";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeout: number;
  maxRetries: number;
}

function getLLMConfig(): LLMConfig {
  // Check environment variables
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ollamaUrl = process.env.OLLAMA_URL;
  
  if (openaiKey) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      apiKey: openaiKey,
      timeout: 5000,
      maxRetries: 1,
    };
  }
  
  if (anthropicKey) {
    return {
      provider: "anthropic",
      model: process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307",
      apiKey: anthropicKey,
      timeout: 5000,
      maxRetries: 1,
    };
  }
  
  if (ollamaUrl) {
    return {
      provider: "ollama",
      model: process.env.OLLAMA_MODEL || "llama3.2",
      baseUrl: ollamaUrl,
      timeout: 10000,
      maxRetries: 1,
    };
  }
  
  return {
    provider: "none",
    model: "",
    timeout: 0,
    maxRetries: 0,
  };
}

// ============================================================================
// Prompt Templates
// ============================================================================

function buildSystemPrompt(allowedBrands: string[], allowedCategories: string[], allowedGenders: string[]): string {
  return `You are a search query normalizer for a fashion e-commerce platform. Your task is to:
1. Fix spelling mistakes
2. Transliterate Arabizi (Arabic written in Latin characters with numbers) to proper form
3. Normalize the query for search

Rules:
- Only use brands from this list: ${allowedBrands.slice(0, 30).join(", ")}${allowedBrands.length > 30 ? "..." : ""}
- Only use categories from this list: ${allowedCategories.join(", ")}
- Gender values: ${allowedGenders.join(", ")}
- Keep the query concise (max 5-6 words)
- If unsure, keep the original word
- Preserve the user's intent

Arabizi examples:
- "7" = ح (ha), "3" = ع (ain), "2" = ء/أ (hamza)
- "qamees" = shirt, "bantalon" = pants, "fostan" = dress
- "aswad" = black, "abyad" = white, "azra2" = blue

Respond ONLY with valid JSON in this exact format:
{
  "rewrittenQuery": "the normalized query",
  "confidence": 0.0 to 1.0,
  "extractedBrand": "brand name or null",
  "extractedCategory": "category or null",
  "extractedGender": "gender or null",
  "explanation": "brief explanation"
}`;
}

function buildUserPrompt(request: LLMRewriteRequest): string {
  let scriptInfo = "";
  if (request.script.hasArabizi) {
    scriptInfo = " (contains Arabizi - Arabic in Latin script with numbers)";
  } else if (request.script.hasArabic) {
    scriptInfo = " (contains Arabic script)";
  } else if (request.script.primary === "mixed") {
    scriptInfo = " (mixed languages)";
  }
  
  return `Normalize this search query${scriptInfo}:
"${request.originalQuery}"

Normalized form: "${request.normalizedQuery}"`;
}

// ============================================================================
// LLM Providers
// ============================================================================

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  config: LLMConfig
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.timeout),
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  config: LLMConfig
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(config.timeout),
  });
  
  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.content[0].text;
}

async function callOllama(
  systemPrompt: string,
  userPrompt: string,
  config: LLMConfig
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: `${systemPrompt}\n\nUser: ${userPrompt}\n\nAssistant:`,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 200,
      },
    }),
    signal: AbortSignal.timeout(config.timeout),
  });
  
  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.response;
}

// ============================================================================
// Main LLM Rewrite Function
// ============================================================================

let llmEnabled: boolean | null = null;

/**
 * Check if LLM is available
 */
export function isLLMAvailable(): boolean {
  if (llmEnabled === null) {
    const config = getLLMConfig();
    llmEnabled = config.provider !== "none";
    if (llmEnabled) {
      console.log(`LLM rewriter enabled: ${config.provider} (${config.model})`);
    } else {
      console.log("LLM rewriter disabled: no API key configured");
    }
  }
  return llmEnabled;
}

/**
 * Rewrite query using LLM
 */
export async function rewriteWithLLM(request: LLMRewriteRequest): Promise<LLMRewriteResponse | null> {
  const llmConfig = getLLMConfig();
  
  if (llmConfig.provider === "none") {
    return null;
  }
  
  const systemPrompt = buildSystemPrompt(
    request.allowedBrands,
    request.allowedCategories,
    request.allowedGenders
  );
  const userPrompt = buildUserPrompt(request);
  
  let rawResponse: string;
  
  try {
    switch (llmConfig.provider) {
      case "openai":
        rawResponse = await callOpenAI(systemPrompt, userPrompt, llmConfig);
        break;
      case "anthropic":
        rawResponse = await callAnthropic(systemPrompt, userPrompt, llmConfig);
        break;
      case "ollama":
        rawResponse = await callOllama(systemPrompt, userPrompt, llmConfig);
        break;
      default:
        return null;
    }
    
    // Parse JSON response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("LLM response not valid JSON:", rawResponse);
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate response
    if (!parsed.rewrittenQuery || typeof parsed.confidence !== "number") {
      console.warn("LLM response missing required fields:", parsed);
      return null;
    }
    
    // Validate brand if extracted
    if (parsed.extractedBrand) {
      const brandLower = parsed.extractedBrand.toLowerCase();
      const validBrand = request.allowedBrands.some(b => b.toLowerCase() === brandLower);
      if (!validBrand) {
        console.warn(`LLM extracted unknown brand: ${parsed.extractedBrand}`);
        parsed.extractedBrand = undefined;
        parsed.confidence *= 0.8;  // Reduce confidence
      }
    }
    
    // Validate category if extracted
    if (parsed.extractedCategory) {
      const catLower = parsed.extractedCategory.toLowerCase();
      const validCat = request.allowedCategories.some(c => c.toLowerCase() === catLower);
      if (!validCat) {
        console.warn(`LLM extracted unknown category: ${parsed.extractedCategory}`);
        parsed.extractedCategory = undefined;
        parsed.confidence *= 0.8;
      }
    }
    
    return {
      rewrittenQuery: parsed.rewrittenQuery,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      extractedBrand: parsed.extractedBrand,
      extractedCategory: parsed.extractedCategory,
      extractedGender: parsed.extractedGender,
      explanation: parsed.explanation,
    };
    
  } catch (err) {
    console.warn("LLM rewrite failed:", err);
    return null;
  }
}

function isLLMConservativeMode(): boolean {
  const v = String(process.env.SEARCH_LLM_CONSERVATIVE ?? "").toLowerCase();
  return v === "1" || v === "true";
}

function isCommerceMode(): boolean {
  const v = String(process.env.SEARCH_COMMERCE_MODE ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Decide if LLM should be called based on query characteristics
 */
export function shouldUseLLM(
  query: string,
  script: ScriptAnalysis,
  hasRuleCorrection: boolean,
  ruleConfidence: number
): boolean {
  if (!isLLMAvailable()) return false;

  if (hasRuleCorrection && ruleConfidence >= 0.85) return false;

  const wordCount = query.trim().split(/\s+/).length;
  const conservative = isLLMConservativeMode() || isCommerceMode();
  if (conservative && wordCount <= 4 && hasRuleCorrection) return false;

  if (script.primary === "mixed") return true;
  if (wordCount >= 5) return true;
  if (script.hasArabizi && !hasRuleCorrection) return true;
  if (script.primary === "ar" && !hasRuleCorrection) return true;

  return false;
}
