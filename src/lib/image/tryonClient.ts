/**
 * Google Cloud Vertex AI Virtual Try-On Client
 *
 * Calls the Vertex AI Virtual Try-On API — no GPU, no local model, no Python service.
 *
 * Setup:
 *   1. Enable Vertex AI API in your GCP project:
 *      gcloud services enable aiplatform.googleapis.com
 *   2. Set GCLOUD_PROJECT env var to your GCP project ID
 *   3. Authenticate (pick one):
 *      - Local dev:  gcloud auth application-default login
 *      - Service account: set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 */

import { GoogleAuth } from "google-auth-library";
import { config } from "../../config";

// ============================================================================
// Types
// ============================================================================

export interface TryOnHealthResponse {
  ok: boolean;
  /** Always Vertex AI Virtual Try-On predict API (managed Imagen model) */
  backend: "vertex-ai-virtual-try-on";
  model_loaded: boolean;       // always true for managed API
  gpu_available: boolean;      // always false — no local GPU needed
  gpu_name: string | null;
  vram_total_gb: number | null;
  vram_used_gb: number | null;
  preprocessing_models: {
    densepose: boolean;
    human_parse: boolean;
    openpose: boolean;
  };
  project: string;
  location: string;
  model: string;
  predictPath: string;
  version: string;
}

export interface TryOnResult {
  success: boolean;
  image_base64: string;
  image_width: number;
  image_height: number;
  processing_time_ms: number;
  preprocessing_time_ms: number;
  inference_time_ms: number;
  seed_used: number;
  category: string;
}

export interface TryOnBatchResult {
  success: boolean;
  results: TryOnResult[];
  total_time_ms: number;
}

export interface TryOnOptions {
  garmentDescription?: string;
  category?: "upper_body" | "lower_body" | "dresses";
  numberOfImages?: number;     // Vertex AI `sampleCount` (1..4)
}

// ============================================================================
// Client Class
// ============================================================================

export class TryOnClient {
  private readonly project: string;
  private readonly location: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly auth: GoogleAuth;

  constructor(opts?: {
    project?: string;
    location?: string;
    model?: string;
    timeout?: number;
  }) {
    this.project  = opts?.project  ?? config.tryon.project;
    this.location = opts?.location ?? config.tryon.location;
    this.model    = opts?.model    ?? config.tryon.model;
    this.timeout  = opts?.timeout  ?? config.tryon.timeout;
    this.auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }

  /** Vertex AI Generative AI — Virtual Try-On REST `:predict` */
  private get predictUrl(): string {
    return (
      `https://${this.location}-aiplatform.googleapis.com/v1` +
      `/projects/${this.project}/locations/${this.location}` +
      `/publishers/google/models/${this.model}:predict`
    );
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  private async getBearerToken(): Promise<string> {
    const client = await this.auth.getClient();
    const tokenRes = await client.getAccessToken();
    const token = tokenRes?.token ?? tokenRes;
    if (!token) throw new Error("Failed to obtain Google Cloud access token");
    return String(token);
  }

  // -------------------------------------------------------------------------
  // Health / Availability
  // -------------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    try {
      await this.getBearerToken();
      return this.project.length > 0;
    } catch {
      return false;
    }
  }

  async health(): Promise<TryOnHealthResponse> {
    const credentialsOk = await this.isAvailable();
    return {
      ok: credentialsOk,
      backend: "vertex-ai-virtual-try-on",
      model_loaded: true,           // managed — always loaded
      gpu_available: false,         // no local GPU needed
      gpu_name: null,
      vram_total_gb: null,
      vram_used_gb: null,
      preprocessing_models: {       // handled by Google internally
        densepose: true,
        human_parse: true,
        openpose: true,
      },
      project: this.project,
      location: this.location,
      model: this.model,
      predictPath: `/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}:predict`,
      version: "vertex-ai",
    };
  }

  // -------------------------------------------------------------------------
  // Core inference
  // -------------------------------------------------------------------------

  /**
   * Run virtual try-on from image Buffers.
   * person + garment → result image (base64 PNG)
   */
  async tryOnFromBuffers(
    personBuffer: Buffer,
    garmentBuffer: Buffer,
    options: TryOnOptions = {}
  ): Promise<TryOnResult> {
    if (!this.project) {
      throw new Error(
        "GCLOUD_PROJECT env var is required for Vertex AI Virtual Try-On"
      );
    }

    const start = Date.now();
    const token = await this.getBearerToken();

    const sampleCount = Math.min(4, Math.max(1, options.numberOfImages ?? 1));
    const cfg = config.tryon;
    const parameters: Record<string, unknown> = {
      sampleCount,
    };
    if (cfg.storageUri) {
      parameters.storageUri = cfg.storageUri;
    }

    // Vertex AI Virtual Try-On — publishers/google/models/MODEL:predict
    // https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-virtual-try-on-images
    const body = {
      instances: [
        {
          personImage: {
            image: {
              bytesBase64Encoded: personBuffer.toString("base64"),
            },
          },
          productImages: [
            {
              image: {
                bytesBase64Encoded: garmentBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
      parameters,
    };

    const response = await fetch(this.predictUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `Vertex AI Virtual Try-On (predict) failed: ${response.status} — ${err}`
      );
    }

    const json = (await response.json()) as {
      predictions: Array<{ bytesBase64Encoded: string; mimeType?: string }>;
    };

    const prediction = json.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      throw new Error("Vertex AI returned no prediction image");
    }

    const processing_time_ms = Date.now() - start;

    return {
      success: true,
      image_base64: prediction.bytesBase64Encoded,
      image_width: 0,               // Vertex AI does not return dimensions
      image_height: 0,
      processing_time_ms,
      preprocessing_time_ms: 0,     // handled server-side by Google
      inference_time_ms: processing_time_ms,
      seed_used: 0,                 // not applicable
      category: options.category ?? "upper_body",
    };
  }

  /**
   * Run try-on from image URLs (downloads then sends)
   */
  async tryOnFromUrls(
    personImageUrl: string,
    garmentImageUrl: string,
    options: TryOnOptions = {}
  ): Promise<TryOnResult> {
    const [personBuf, garmentBuf] = await Promise.all([
      this.downloadImage(personImageUrl),
      this.downloadImage(garmentImageUrl),
    ]);
    return this.tryOnFromBuffers(personBuf, garmentBuf, options);
  }

  /**
   * Batch: same person, multiple garments — runs requests in parallel
   */
  async tryOnBatch(
    personBuffer: Buffer,
    garments: Array<{ buffer: Buffer; description?: string }>,
    options: Omit<TryOnOptions, "garmentDescription"> = {}
  ): Promise<TryOnBatchResult> {
    const batchStart = Date.now();

    const results = await Promise.all(
      garments.map((g) =>
        this.tryOnFromBuffers(personBuffer, g.buffer, {
          ...options,
          garmentDescription: g.description,
        })
      )
    );

    return {
      success: true,
      results,
      total_time_ms: Date.now() - batchStart,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async downloadImage(url: string): Promise<Buffer> {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      throw new Error(`Failed to download image: ${resp.status}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let clientInstance: TryOnClient | null = null;

export function getTryOnClient(): TryOnClient {
  if (!clientInstance) {
    clientInstance = new TryOnClient();
  }
  return clientInstance;
}
