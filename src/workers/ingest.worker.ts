console.log("Starting ingest worker (Upstash REST)...");

import { upstashGet, upstashSet } from "../lib/queue";
import fetch from "node-fetch";
import sharp from "sharp";
import { pg } from "../lib/core";
import { config } from "../config";
import { getImageAnalysisService } from "../routes/products/image-analysis.service";
import { uploadImage, processImageForEmbedding, computePHash, validateImage } from "../lib/image";

async function processIngestJobs() {
  const queueRes = await upstashGet("ingest-job-queue");
  const jobIds = queueRes.result ? JSON.parse(queueRes.result) : [];

  for (const jobId of jobIds) {
    const jobRes = await upstashGet(`ingest-job:${jobId}`);
    if (!jobRes.result) continue;
    const jobData = JSON.parse(jobRes.result);
    const { job_uuid, user_id: userId, r2_key, cdn_url, filename } = jobData;

    try {
      await pg.query("UPDATE ingest_jobs SET status=$1, attempts = attempts + 1 WHERE job_uuid=$2", ["processing", job_uuid]);

      const resp = await fetch(cdn_url, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const validation = await validateImage(buffer).catch(() => ({ valid: true }));
      if (!validation.valid) throw new Error((validation as any).error || "Invalid image");

      const analysis = await getImageAnalysisService().analyzeImage(buffer, filename, { store: false, generateEmbedding: true, runDetection: true });

      let createdItems: number[] = [];

      if (analysis.detection && Array.isArray(analysis.detection.items)) {
        for (const det of analysis.detection.items) {
          try {
            const box = det.box;
            const cropLeft = Math.max(0, Math.round(box.x1));
            const cropTop = Math.max(0, Math.round(box.y1));
            const cropWidth = Math.max(1, Math.round(box.x2 - box.x1));
            const cropHeight = Math.max(1, Math.round(box.y2 - box.y1));

            const safeWidth = Math.min(cropWidth, (analysis.image && (analysis.image.width || 0)) || cropWidth);
            const safeHeight = Math.min(cropHeight, (analysis.image && (analysis.image.height || 0)) || cropHeight);

            if (safeWidth < 8 || safeHeight < 8) continue;

            const cropBuffer = await sharp(buffer).extract({ left: cropLeft, top: cropTop, width: safeWidth, height: safeHeight }).resize(256, 256, { fit: 'inside' }).toBuffer();

            const { key: cropKey, cdnUrl: cropCdn } = await uploadImage(cropBuffer);

            const pHash = await computePHash(cropBuffer);
            const embedding = await processImageForEmbedding(cropBuffer);

            const insertRes = await pg.query(
              `INSERT INTO wardrobe_items (user_id, source, image_url, image_cdn, r2_key, p_hash, attributes_extracted, extraction_version, extraction_confidence, embedding)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING id`,
              [userId, 'uploaded', cropCdn, cropCdn, cropKey, pHash, true, 'auto-ingest-1.0', det.confidence || null, embedding]
            );

            if ((insertRes.rowCount ?? 0) > 0) createdItems.push(insertRes.rows[0].id);
          } catch (err) {
            console.error("Error processing detection crop:", err);
            continue;
          }
        }
      }

      await pg.query("UPDATE ingest_jobs SET status=$1, result_json=$2 WHERE job_uuid=$3", ["completed", { created: createdItems.length, items: createdItems }, job_uuid]);

      jobIds.splice(jobIds.indexOf(jobId), 1);
      await upstashSet("ingest-job-queue", JSON.stringify(jobIds));
      await upstashSet(`ingest-job:${jobId}`, "");

      console.log(`Job ${jobId} completed`);
    } catch (err: any) {
      console.error("Ingest job failed:", err?.message || err);
      await pg.query("UPDATE ingest_jobs SET status=$1, error_message=$2 WHERE job_uuid=$3", ["failed", err?.message || String(err), job_uuid]);
    }
  }
}

processIngestJobs().then(() => {
  console.log("Ingest worker finished batch.");
}).catch((err) => {
  console.error("Worker error:", err);
});
          try {
            const box = det.box;
            const cropLeft = Math.max(0, Math.round(box.x1));
            const cropTop = Math.max(0, Math.round(box.y1));
            const cropWidth = Math.max(1, Math.round(box.x2 - box.x1));
            const cropHeight = Math.max(1, Math.round(box.y2 - box.y1));

            const safeWidth = Math.min(cropWidth, (analysis.image && (analysis.image.width || 0)) || cropWidth);
            const safeHeight = Math.min(cropHeight, (analysis.image && (analysis.image.height || 0)) || cropHeight);

            if (safeWidth < 8 || safeHeight < 8) continue;

            const cropBuffer = await sharp(buffer).extract({ left: cropLeft, top: cropTop, width: safeWidth, height: safeHeight }).resize(256, 256, { fit: 'inside' }).toBuffer();

            // Upload crop to R2
            const { key: cropKey, cdnUrl: cropCdn } = await uploadImage(cropBuffer);

            const pHash = await computePHash(cropBuffer);
            const embedding = await processImageForEmbedding(cropBuffer);

            // Upsert into wardrobe_items
            const insertRes = await pg.query(
              `INSERT INTO wardrobe_items (user_id, source, image_url, image_cdn, r2_key, p_hash, attributes_extracted, extraction_version, extraction_confidence, embedding)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING id`,
              [userId, 'uploaded', cropCdn, cropCdn, cropKey, pHash, true, 'auto-ingest-1.0', det.confidence || null, embedding]
            );

            if ((insertRes.rowCount ?? 0) > 0) createdItems.push(insertRes.rows[0].id);
          } catch (err) {
            console.error("Error processing detection crop:", err);
            continue;
          }
        }
      }

      // Update ingest job
      await pg.query("UPDATE ingest_jobs SET status=$1, result_json=$2 WHERE job_uuid=$3", ["completed", { created: createdItems.length, items: createdItems }, job_uuid]);

      return { ok: true, created: createdItems.length };
    } catch (err: any) {
      console.error("Ingest job failed:", err?.message || err);
      await pg.query("UPDATE ingest_jobs SET status=$1, error_message=$2 WHERE job_uuid=$3", ["failed", err?.message || String(err), job_uuid]);
      throw err;
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err?.message || err);
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});
