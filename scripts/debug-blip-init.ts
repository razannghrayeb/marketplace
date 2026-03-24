import { blip } from "../src/lib/image/blip";

async function main() {
  try {
    console.log("Starting BLIP init...");
    await blip.init();
    console.log("BLIP init OK");
  } catch (err: any) {
    console.error("BLIP init FAILED:");
    console.error("message:", err?.message);
    console.error("stack:", err?.stack);
    console.error("cause:", err?.cause);
    process.exitCode = 1;
  }
}

main();

