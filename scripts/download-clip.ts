/**
 * Download CLIP ONNX models for image embedding
 * 
 * Run with: npx tsx scripts/download-clip.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";

const MODEL_DIR = path.join(process.cwd(), "models");

// CLIP ViT-B/32 ONNX model URLs (from Hugging Face)
const MODELS = [
  {
    name: "clip-image-vit-32.onnx",
    url: "https://huggingface.co/rocca/openai-clip-js/resolve/main/clip-image-vit-32-float32.onnx",
    size: "351MB",
  },
  // Text model is optional - uncomment if you want text-to-image search
  // {
  //   name: "clip-text-vit-32.onnx", 
  //   url: "https://huggingface.co/rocca/openai-clip-js/resolve/main/clip-text-vit-32-float32.onnx",
  //   size: "254MB",
  // },
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

  for (const model of MODELS) {
    const destPath = path.join(MODEL_DIR, model.name);

    if (fs.existsSync(destPath)) {
      console.log(`✓ ${model.name} already exists, skipping...`);
      continue;
    }

    console.log(`Downloading ${model.name} (~${model.size})...`);
    console.log(`URL: ${model.url}`);

    try {
      await downloadFile(model.url, destPath);
      console.log(`✓ Saved to ${destPath}\n`);
    } catch (error) {
      console.error(`✗ Failed to download ${model.name}:`, error);
      process.exit(1);
    }
  }

  console.log("\n✓ All models downloaded!");
  console.log("\nYou can now use CLIP embeddings in your application.");
}

main().catch(console.error);
