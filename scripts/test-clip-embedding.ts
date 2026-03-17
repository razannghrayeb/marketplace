/**
 * Quick test to verify CLIP models work with new input/output names
 */
import { initClip, getImageEmbedding } from "../src/lib/image/clip.js";

async function test() {
  try {
    console.log("Testing CLIP image embedding...\n");

    // Initialize CLIP
    await initClip();
    console.log("✓ CLIP initialized successfully\n");

    // Create a dummy preprocessed image (3 x 224 x 224)
    const size = 224;
    const channels = 3;
    const dummyImage = new Float32Array(channels * size * size);

    // Fill with normalized random values
    for (let i = 0; i < dummyImage.length; i++) {
      dummyImage[i] = (Math.random() - 0.5) * 2; // Range [-1, 1]
    }

    console.log("Running inference on dummy image...");
    const embedding = await getImageEmbedding(dummyImage);

    console.log(`✓ Generated embedding: ${embedding.length} dimensions`);
    console.log(`  First 10 values: ${embedding.slice(0, 10).map(v => v.toFixed(4)).join(", ")}`);

    // Verify L2 normalization (should be ~1.0)
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    console.log(`  L2 norm: ${norm.toFixed(6)} (should be ≈1.0)`);

    if (Math.abs(norm - 1.0) < 0.01) {
      console.log("\n✓✓✓ TEST PASSED: Embeddings are properly normalized ✓✓✓");
    } else {
      console.log("\n⚠ Warning: Embedding norm is off");
    }

  } catch (error) {
    console.error("\n✗✗✗ TEST FAILED ✗✗✗");
    console.error(error);
    process.exit(1);
  }
}

test();
