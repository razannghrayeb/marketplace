import { GoogleAuth } from "google-auth-library";
import { config } from "../../config";

export interface VertexGenerateContentParams {
  systemInstruction?: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  modelId?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

export async function generateVertexContentText(
  params: VertexGenerateContentParams,
): Promise<string> {
  const vertexConfig = config.vertexGenerative;
  const project = vertexConfig.project.trim();
  if (!project) {
    throw new Error("Vertex AI Gemini is not configured: set GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT");
  }

  const location = vertexConfig.location.trim() || "global";
  const apiEndpoint = trimTrailingSlash(vertexConfig.apiEndpoint.trim() || "https://aiplatform.googleapis.com");
  const modelId = (params.modelId || vertexConfig.modelId || "gemini-2.5-flash").trim();
  const generateContentApi = vertexConfig.generateContentApi.trim() || "generateContent";

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = tokenResult?.token ?? tokenResult;
  if (!token) {
    throw new Error("Failed to obtain Google Cloud access token for Vertex AI Gemini");
  }

  const response = await fetch(
    `${apiEndpoint}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(modelId)}:${generateContentApi}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${String(token)}`,
      },
      body: JSON.stringify({
        ...(params.systemInstruction
          ? { systemInstruction: { parts: [{ text: params.systemInstruction }] } }
          : {}),
        contents: [{ role: "user", parts: [{ text: params.userPrompt }] }],
        generationConfig: {
          temperature: params.temperature ?? 0.35,
          maxOutputTokens: params.maxOutputTokens ?? 512,
          responseMimeType: params.responseMimeType ?? "application/json",
        },
      }),
      signal: AbortSignal.timeout(12000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vertex AI generateContent failed: ${response.status} — ${errorText}`);
  }

  const data = await response.json();
  return extractTextFromParts(data?.candidates?.[0]?.content?.parts);
}