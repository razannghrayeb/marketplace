/**
 * Test BLIP captioning to ensure it works
 */
import "dotenv/config";
import { blip } from "../src/lib/image/blip.js";
import * as fs from "fs";

async function test() {
  try {
    console.log("Initializing BLIP...\n");
    await blip.init();
    console.log("✓ BLIP initialized\n");

    // Create a simple test image (red square)
    const sharp = (await import("sharp")).default;
    const testImage = await sharp({
      create: {
        width: 384,
        height: 384,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    console.log("Generating caption for test image...");
    const caption = await blip.caption(testImage);
    console.log(`✓ Generated caption: "${caption}"`);

    if (caption && caption.length > 0) {
      console.log("\n✓✓✓ BLIP is working! ✓✓✓");
    } else {
      console.log("\n⚠ Warning: Empty caption generated");
    }
  } catch (error) {
    console.error("\n✗✗✗ BLIP test failed ✗✗✗");
    console.error(error);
    process.exit(1);
  }
}

test();
