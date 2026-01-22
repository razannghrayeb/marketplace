/**
 * Download CLIP ONNX models for image embedding
 * 
 * Supported models:
 * 1. Fashion-CLIP - Best for apparel (fabric textures, styles, details)
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
import * as https from "https";

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

const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    type: "fashion-clip",
    description: "Fashion-CLIP: Fine-tuned on fashion data - BEST for apparel details, fabric textures",
    embeddingDim: 512,
    recommended: true,
    models: [
      {
        name: "fashion-clip-image.onnx",
        url: "https://huggingface.co/patrickjohncyh/fashion-clip/resolve/main/fashion-clip-image.onnx",
        size: "350MB",
      },
      {
        name: "fashion-clip-text.onnx",
        url: "https://huggingface.co/patrickjohncyh/fashion-clip/resolve/main/fashion-clip-text.onnx",
        size: "254MB",
      },
    ],
  },
  {
    type: "vit-l-14",
    description: "CLIP ViT-L/14: Larger model with 768-dim embeddings - higher accuracy",
    embeddingDim: 768,
    recommended: false,
    models: [
      {
        name: "clip-image-vit-l-14.onnx",
        url: "https://huggingface.co/Xenova/clip-vit-large-patch14/resolve/main/onnx/vision_model.onnx",
        size: "1.2GB",
      },
      {
        name: "clip-text-vit-l-14.onnx",
        url: "https://huggingface.co/Xenova/clip-vit-large-patch14/resolve/main/onnx/text_model.onnx",
        size: "492MB",
      },
    ],
  },
  {
    type: "vit-b-32",
    description: "CLIP ViT-B/32: Baseline model (legacy) - faster but less accurate",
    embeddingDim: 512,
    recommended: false,
    models: [
      {
        name: "clip-image-vit-32.onnx",
        url: "https://huggingface.co/rocca/openai-clip-js/resolve/main/clip-image-vit-32-float32.onnx",
        size: "351MB",
      },
      // Text model is optional
      // {
      //   name: "clip-text-vit-32.onnx", 
      //   url: "https://huggingface.co/rocca/openai-clip-js/resolve/main/clip-text-vit-32-float32.onnx",
      //   size: "254MB",
      // },
    ],
  },
];

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloadedBytes = 0;
    let totalBytes = 0;

    const request = https.get(url, { 
      headers: { "User-Agent": "Mozilla/5.0" }
    }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(dest);
          console.log("Following redirect...");
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      totalBytes = parseInt(response.headers["content-length"] || "0", 10);

      response.pipe(file);

      response.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        const percent = totalBytes > 0 
          ? ((downloadedBytes / totalBytes) * 100).toFixed(1) 
          : "?";
        process.stdout.write(`\rDownloading: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)`);
      });

      file.on("finish", () => {
        file.close();
        console.log("\nDownload complete!");
        resolve();
      });
    });

    request.on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });

    file.on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
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
  const modelArg = args.find(a => a.startsWith("--model="))?.split("=")[1] || 
                   (args.includes("--model") ? args[args.indexOf("--model") + 1] : null);

  // Determine which models to download
  let modelsToDownload: ModelDefinition[];
  
  if (downloadAll) {
    modelsToDownload = MODEL_DEFINITIONS;
    console.log("Downloading ALL models...\n");
  } else if (modelArg) {
    const selectedModel = MODEL_DEFINITIONS.find(m => m.type === modelArg);
    if (!selectedModel) {
      console.error(`Unknown model: ${modelArg}`);
      console.log("Available models: fashion-clip, vit-l-14, vit-b-32");
      process.exit(1);
    }
    modelsToDownload = [selectedModel];
  } else {
    // Default: download recommended model (Fashion-CLIP)
    modelsToDownload = MODEL_DEFINITIONS.filter(m => m.recommended);
    console.log("Downloading recommended model (Fashion-CLIP)...");
    console.log("Use --all to download all models, or --model <name> for specific model.\n");
  }

  // Show what will be downloaded
  console.log("Models to download:");
  for (const def of modelsToDownload) {
    console.log(`  • ${def.type}: ${def.description}`);
    console.log(`    Embedding dimension: ${def.embeddingDim}`);
  }
  console.log("");

  // Download each model
  for (const modelDef of modelsToDownload) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Downloading ${modelDef.type.toUpperCase()}`);
    console.log(`${"=".repeat(60)}`);
    
    for (const model of modelDef.models) {
      const destPath = path.join(MODEL_DIR, model.name);

      if (fs.existsSync(destPath)) {
        console.log(`✓ ${model.name} already exists, skipping...`);
        continue;
      }

      console.log(`\nDownloading ${model.name} (~${model.size})...`);
      console.log(`URL: ${model.url}`);

      try {
        await downloadFile(model.url, destPath);
        console.log(`✓ Saved to ${destPath}`);
      } catch (error) {
        console.error(`✗ Failed to download ${model.name}:`, error);
        console.log("You can try downloading manually from the URL above.");
        // Continue with other models instead of exiting
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✓ Download complete!");
  console.log("=".repeat(60));
  
  // Show summary
  console.log("\nAvailable models:");
  for (const def of MODEL_DEFINITIONS) {
    const imageModelPath = path.join(MODEL_DIR, def.models[0].name);
    const available = fs.existsSync(imageModelPath);
    const status = available ? "✓" : "✗";
    const rec = def.recommended ? " (RECOMMENDED)" : "";
    console.log(`  ${status} ${def.type}${rec}: ${def.embeddingDim}-dim embeddings`);
  }
  
  console.log("\nTo use a specific model, set CLIP_MODEL_TYPE environment variable:");
  console.log("  CLIP_MODEL_TYPE=fashion-clip pnpm dev");
  console.log("\nOr the system will auto-select the best available model.");
}

main().catch(console.error);
