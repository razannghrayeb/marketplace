import sharpLib from "sharp";
import * as path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const sharp: any = typeof sharpLib === "function" ? sharpLib : (sharpLib as any).default;

type ImageRerankCandidateInput = {
  id: string;
  imageUrl?: string | null;
  imageBuffer?: Buffer | null;
  baseScore?: number;
};

type ImageRerankScore = {
  id: string;
  score: number;
};

type ImageRerankRequest = {
  query_image_b64: string;
  candidates: Array<{
    id: string;
    image_b64: string;
  }>;
};

type ImageRerankResponse = {
  scores?: ImageRerankScore[];
  count?: number;
  execution_providers?: string[];
  max_batch_size?: number;
};

const ONNX_API_URL = process.env.ONNX_API_URL || "http://0.0.0.0:8002";
const ONNX_GRPC_ADDRESS = process.env.ONNX_GRPC_ADDRESS || "127.0.0.1:50051";
const ONNX_RERANK_TIMEOUT_MS = Math.max(500, Number(process.env.ONNX_RERANK_TIMEOUT_MS || 8000) || 8000);
const IMAGE_RERANK_TOPK = Math.max(10, Number(process.env.SEARCH_IMAGE_RERANK_TOPK || 200) || 200);
const IMAGE_RERANK_ENABLED = String(process.env.SEARCH_IMAGE_ONNX_RERANK ?? "1").toLowerCase() !== "0";
const IMAGE_RERANK_TRANSPORT = String(process.env.SEARCH_IMAGE_RERANK_TRANSPORT ?? "grpc").toLowerCase();
const IMAGE_RERANK_INPUT_SIZE = Math.max(224, Number(process.env.SEARCH_IMAGE_RERANK_INPUT_SIZE || 224) || 224);

const PROTO_PATH = path.resolve(process.cwd(), "src", "lib", "model", "proto", "rerank.proto");

let rerankerHealthy: boolean | null = null;
let rerankerLastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

type GrpcHealthResponse = {
  ready?: boolean;
  status?: string;
  executionProvider?: string;
  execution_provider?: string;
};

type GrpcRerankResponse = {
  scores?: Array<{ id?: string; score?: number }>;
  count?: number;
  maxBatchSize?: number;
  max_batch_size?: number;
};

type GrpcClient = {
  Health: (
    request: Record<string, never>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (err: grpc.ServiceError | null, response: GrpcHealthResponse) => void,
  ) => void;
  RerankImagePairs: (
    request: {
      queryImageBytes: Buffer;
      candidates: Array<{ id: string; imageBytes: Buffer }>;
    },
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (err: grpc.ServiceError | null, response: GrpcRerankResponse) => void,
  ) => void;
};

let grpcClient: GrpcClient | null = null;

function getGrpcClient(): GrpcClient {
  if (grpcClient) return grpcClient;
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const Ctor = proto.marketplace.rerank.v1.ImageReranker;
  grpcClient = new Ctor(ONNX_GRPC_ADDRESS, grpc.credentials.createInsecure()) as GrpcClient;
  return grpcClient;
}

function grpcHealthCheck(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const client = getGrpcClient();
      client.Health(
        {},
        new grpc.Metadata(),
        { deadline: Date.now() + ONNX_RERANK_TIMEOUT_MS },
        (err, response) => {
          if (err) return resolve(false);
          resolve(Boolean(response?.ready));
        },
      );
    } catch {
      resolve(false);
    }
  });
}

function grpcRerank(request: {
  queryImageBytes: Buffer;
  candidates: Array<{ id: string; imageBytes: Buffer }>;
}): Promise<ImageRerankScore[]> {
  return new Promise((resolve, reject) => {
    try {
      const client = getGrpcClient();
      client.RerankImagePairs(
        request,
        new grpc.Metadata(),
        { deadline: Date.now() + ONNX_RERANK_TIMEOUT_MS },
        (err, response) => {
          if (err) return reject(err);
          const scores = Array.isArray(response?.scores)
            ? response.scores.map((s) => ({ id: String(s.id ?? ""), score: Number(s.score ?? 0) }))
            : [];
          resolve(scores);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch image: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downscaleForRerank(buffer: Buffer): Promise<string> {
  const jpeg = await sharp(buffer)
    .rotate()
    .resize(IMAGE_RERANK_INPUT_SIZE, IMAGE_RERANK_INPUT_SIZE, {
      fit: "cover",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
    })
    .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return jpeg.toString("base64");
}

async function loadCandidateImage(candidate: ImageRerankCandidateInput): Promise<{ id: string; image_b64: string } | null> {
  try {
    if (candidate.imageBuffer && candidate.imageBuffer.length > 0) {
      return {
        id: candidate.id,
        image_b64: await downscaleForRerank(candidate.imageBuffer),
      };
    }
    if (candidate.imageUrl) {
      const buffer = await fetchImageBuffer(candidate.imageUrl);
      return {
        id: candidate.id,
        image_b64: await downscaleForRerank(buffer),
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function checkRerankerHealth(): Promise<boolean> {
  if (IMAGE_RERANK_TRANSPORT === "grpc" || IMAGE_RERANK_TRANSPORT === "auto") {
    const grpcOk = await grpcHealthCheck();
    if (grpcOk || IMAGE_RERANK_TRANSPORT === "grpc") return grpcOk;
  }

  try {
    const response = await fetch(`${ONNX_API_URL.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(ONNX_RERANK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function isImageRerankerAvailable(): Promise<boolean> {
  if (!IMAGE_RERANK_ENABLED) return false;
  const now = Date.now();
  if (rerankerHealthy !== null && now - rerankerLastHealthCheck < HEALTH_CHECK_INTERVAL_MS) {
    return rerankerHealthy;
  }
  rerankerHealthy = await checkRerankerHealth();
  rerankerLastHealthCheck = now;
  return rerankerHealthy;
}

export async function rerankImageCandidates(params: {
  queryImageBuffer?: Buffer | null;
  candidates: ImageRerankCandidateInput[];
  topK?: number;
}): Promise<ImageRerankScore[]> {
  const queryImageBuffer = params.queryImageBuffer;
  const candidates = params.candidates ?? [];
  if (!IMAGE_RERANK_ENABLED || !queryImageBuffer || queryImageBuffer.length === 0 || candidates.length === 0) {
    return candidates
      .map((candidate, index) => ({
        id: candidate.id,
        score: Number(candidate.baseScore ?? 0) - index * 1e-6,
      }))
      .sort((a, b) => b.score - a.score);
  }

  const available = await isImageRerankerAvailable().catch(() => false);
  if (!available) {
    return candidates
      .map((candidate, index) => ({
        id: candidate.id,
        score: Number(candidate.baseScore ?? 0) - index * 1e-6,
      }))
      .sort((a, b) => b.score - a.score);
  }

  const candidateLimit = Math.min(candidates.length, params.topK ?? IMAGE_RERANK_TOPK, 200);
  const limitedCandidates = candidates.slice(0, candidateLimit);
  const queryImage = await downscaleForRerank(queryImageBuffer);

  const preparedCandidates = await Promise.all(
    limitedCandidates.map((candidate) => loadCandidateImage(candidate)),
  );
  const payloadCandidates = preparedCandidates.filter((candidate): candidate is { id: string; image_b64: string } => Boolean(candidate));

  if (payloadCandidates.length === 0) {
    return candidates
      .map((candidate, index) => ({
        id: candidate.id,
        score: Number(candidate.baseScore ?? 0) - index * 1e-6,
      }))
      .sort((a, b) => b.score - a.score);
  }

  const payload: ImageRerankRequest = {
    query_image_b64: queryImage,
    candidates: payloadCandidates,
  };

  if (IMAGE_RERANK_TRANSPORT === "grpc" || IMAGE_RERANK_TRANSPORT === "auto") {
    try {
      const grpcScores = await grpcRerank({
        queryImageBytes: Buffer.from(queryImage, "base64"),
        candidates: payloadCandidates.map((candidate) => ({
          id: candidate.id,
          imageBytes: Buffer.from(candidate.image_b64, "base64"),
        })),
      });
      const grpcScoreMap = new Map<string, number>(grpcScores.map((item) => [item.id, item.score]));
      const scored = candidates.map((candidate, index) => ({
        id: candidate.id,
        score: grpcScoreMap.get(candidate.id) ?? Number(candidate.baseScore ?? 0) - index * 1e-6,
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored;
    } catch {
      if (IMAGE_RERANK_TRANSPORT === "grpc") {
        return candidates
          .map((candidate, index) => ({
            id: candidate.id,
            score: Number(candidate.baseScore ?? 0) - index * 1e-6,
          }))
          .sort((a, b) => b.score - a.score);
      }
    }
  }

  try {
    const response = await fetch(`${ONNX_API_URL.replace(/\/$/, "")}/rerank/image-pairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ONNX_RERANK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`ONNX rerank HTTP ${response.status}`);
    }

    const body = (await response.json()) as ImageRerankResponse;
    const returned = Array.isArray(body.scores) ? body.scores : [];
    const scoreMap = new Map<string, number>(
      returned.map((item) => [String(item.id), Number(item.score) || 0]),
    );

    const scored = candidates.map((candidate, index) => ({
      id: candidate.id,
      score: scoreMap.get(candidate.id) ?? Number(candidate.baseScore ?? 0) - index * 1e-6,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  } catch {
    return candidates
      .map((candidate, index) => ({
        id: candidate.id,
        score: Number(candidate.baseScore ?? 0) - index * 1e-6,
      }))
      .sort((a, b) => b.score - a.score);
  }
}
