/**
 * Download CLIP ONNX models for image embedding
 *
 * Supported models:
 * 1. Fashion-CLIP (ViT-B/32 base) - 512-dim embeddings
 * 2. ViT-L/14 - Higher accuracy, 768-dim embeddings
 * 3. ViT-B/32 - Baseline model (legacy)
 *
 * Usage:
 *   npx tsx scripts/download-clip.ts              # Download recommended (Fashion-CLIP)
 *   npx tsx scripts/download-clip.ts --all        # Download all models
 *   npx tsx scripts/download-clip.ts --model vit-l-14
 *   npx tsx scripts/download-clip.ts --model fashion-clip
 *   npx tsx scripts/download-clip.ts --model vit-b-32
 */

import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const MODEL_DIR = path.join(process.cwd(), "models");

// ============================================================================
// Model Definitions
// ============================================================================

type ModelType = "fashion-clip" | "vit-l-14" | "vit-b-32";

interface ModelDownload {
  name: string;
  url: string;
  size: string;
}

interface ModelDefinition {
  type: ModelType;
  description: string;
  embeddingDim: number;
  recommended: boolean;
  models: ModelDownload[];
}

const MIN_BYTES_BY_FILE: Record<string, number> = {
  "fashion-clip-image.onnx": 200 * 1024 * 1024,
  "fashion-clip-text.onnx": 120 * 1024 * 1024,
  "clip-image-vit-l-14.onnx": 900 * 1024 * 1024,
  "clip-text-vit-l-14.onnx": 300 * 1024 * 1024,
  "clip-image-vit-32.onnx": 250 * 1024 * 1024,
  "clip-text-vit-32.onnx": 120 * 1024 * 1024,
};

function isValidModelFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    const minBytes = MIN_BYTES_BY_FILE[path.basename(filePath)] ?? 1;
    return stat.isFile() && stat.size >= minBytes;
  } catch {
    return false;
  }
}

// Fashion-CLIP: The original patrickjohncyh/fashion-clip repo only has a combined
// ONNX model (onnx/model.onnx) which cannot be used with split image/text sessions.
// We use Xenova/clip-vit-base-patch32 which provides proper split ONNX encoders
// with the same ViT-B/32 architecture and 512-dim embeddings.
const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    type: "fashion-clip",
    description:
      "CLIP ViT-B/32 (Fashion-CLIP compatible) - 512-dim embeddings for apparel",
    embeddingDim: 512,
    recommended: true,
    models: [
      {
        name: "fashion-clip-image.onnx",
        url: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx",
        size: "~340MB",
      },
      {
        name: "fashion-clip-text.onnx",
        url: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx",
        size: "~250MB",
      },
    ],
  },
  {
    type: "vit-l-14",
    description:
      "CLIP ViT-L/14: Larger model with 768-dim embeddings - higher accuracy",
    embeddingDim: 768,
    recommended: false,
    models: [
      {
        name: "clip-image-vit-l-14.onnx",
        url: "https://huggingface.co/Xenova/clip-vit-large-patch14/resolve/main/onnx/vision_model.onnx",
        size: "~1.2GB",
      },
      {
        name: "clip-text-vit-l-14.onnx",
        url: "https://huggingface.co/Xenova/clip-vit-large-patch14/resolve/main/onnx/text_model.onnx",
        size: "~490MB",
      },
    ],
  },
  {
    type: "vit-b-32",
    description:
      "CLIP ViT-B/32: Baseline model (legacy) - faster but less accurate",
    embeddingDim: 512,
    recommended: false,
    models: [
      {
        name: "clip-image-vit-32.onnx",
        url: "https://huggingface.co/rocca/openai-clip-js/resolve/main/clip-image-vit-32-float32.onnx",
        size: "~351MB",
      },
      {
        name: "clip-text-vit-32.onnx",
        url: "https://huggingface.co/rocca/openai-clip-js/resolve/main/clip-text-vit-32-float32-int32.onnx",
        size: "~254MB",
      },
    ],
  },
];

/**
 * Download a file from a URL to a destination path.
 * Uses Node.js built-in fetch which handles redirects automatically
 * (HuggingFace LFS files use redirect chains to CDN).
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Response body is empty");
  }

  const totalBytes = parseInt(
    response.headers.get("content-length") || "0",
    10
  );
  let downloadedBytes = 0;

  // Convert web ReadableStream to Node.js Readable for piping to fs
  const nodeStream = Readable.fromWeb(response.body as any);
  const fileStream = fs.createWriteStream(dest);

  nodeStream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    const percent =
      totalBytes > 0
        ? ((downloadedBytes / totalBytes) * 100).toFixed(1)
        : "?";
    const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
    const totalMb =
      totalBytes > 0 ? `/${(totalBytes / 1024 / 1024).toFixed(1)}` : "";
    process.stdout.write(`\rDownloading: ${percent}% (${mb}${totalMb} MB)`);
  });

  try {
    await pipeline(nodeStream, fileStream);
    console.log("\nDownload complete!");
  } catch (error) {
    // Clean up partial file on failure
    try {
      fs.unlinkSync(dest);
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }
}

async function main() {
  console.log("CLIP Model Downloader");
  console.log("=====================\n");

  // Create models directory
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    console.log(`Created directory: ${MODEL_DIR}\n`);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const downloadAll = args.includes("--all");
  const modelArg =
    args.find((a) => a.startsWith("--model="))?.split("=")[1] ||
    (args.includes("--model") ? args[args.indexOf("--model") + 1] : null);

  // Determine which models to download
  let modelsToDownload: ModelDefinition[];

  if (downloadAll) {
    modelsToDownload = MODEL_DEFINITIONS;
    console.log("Downloading ALL models...\n");
  } else if (modelArg) {
    const selectedModel = MODEL_DEFINITIONS.find((m) => m.type === modelArg);
    if (!selectedModel) {
      console.error(`Unknown model: ${modelArg}`);
      console.log("Available models: fashion-clip, vit-l-14, vit-b-32");
      process.exit(1);
    }
    modelsToDownload = [selectedModel];
  } else {
    // Default: download recommended model
    modelsToDownload = MODEL_DEFINITIONS.filter((m) => m.recommended);
    console.log("Downloading recommended model (Fashion-CLIP)...");
    console.log(
      "Use --all to download all models, or --model <name> for specific model.\n"
    );
  }

  // Show what will be downloaded
  console.log("Models to download:");
  for (const def of modelsToDownload) {
    console.log(`  - ${def.type}: ${def.description}`);
    console.log(`    Embedding dimension: ${def.embeddingDim}`);
  }
  console.log("");

  const failures: string[] = [];

  // Download each model
  for (const modelDef of modelsToDownload) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Downloading ${modelDef.type.toUpperCase()}`);
    console.log(`${"=".repeat(60)}`);

    for (const model of modelDef.models) {
      const destPath = path.join(MODEL_DIR, model.name);

      if (fs.existsSync(destPath)) {
        if (isValidModelFile(destPath)) {
          console.log(`\n[OK] ${model.name} already exists, skipping...`);
          continue;
        }
        console.log(
          `\n[!] ${model.name} exists but appears invalid/corrupt. Re-downloading...`
        );
        fs.unlinkSync(destPath);
      }

      console.log(`\nDownloading ${model.name} (${model.size})...`);
      console.log(`URL: ${model.url}`);

      try {
        await downloadFile(model.url, destPath);
        if (!isValidModelFile(destPath)) {
          failures.push(`${model.name}: downloaded file is too small/invalid`);
          console.error(
            `[FAIL] ${model.name} downloaded but appears invalid/corrupt.`
          );
          continue;
        }
        console.log(`[OK] Saved to ${destPath}`);
      } catch (error) {
        console.error(`\n[FAIL] Failed to download ${model.name}:`, error);
        console.log("You can try downloading manually from the URL above.");
        failures.push(`${model.name}: ${(error as Error).message}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Download complete!");
  console.log("=".repeat(60));

  // Show summary
  console.log("\nAvailable models:");
  for (const def of MODEL_DEFINITIONS) {
    const imageModelPath = path.join(MODEL_DIR, def.models[0].name);
    const available = isValidModelFile(imageModelPath);
    const status = available ? "[OK]" : "[--]";
    const rec = def.recommended ? " (RECOMMENDED)" : "";
    console.log(
      `  ${status} ${def.type}${rec}: ${def.embeddingDim}-dim embeddings`
    );
  }

  if (failures.length > 0) {
    console.error("\nSome model downloads failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
  }

  console.log(
    "\nTo use a specific model, set CLIP_MODEL_TYPE environment variable:"
  );
  console.log("  CLIP_MODEL_TYPE=fashion-clip pnpm dev");
  console.log("\nOr the system will auto-select the best available model.");
}

main().catch(console.error);
