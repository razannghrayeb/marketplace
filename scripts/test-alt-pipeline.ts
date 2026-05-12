#!/usr/bin/env node
import * as fs from "fs";
import path from "path";
import altImageSearch from "../src/lib/search/altPipeline";

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error("Usage: pnpm exec tsx scripts/test-alt-pipeline.ts <image-path>");
    process.exit(2);
  }
  const abs = path.isAbsolute(imgPath) ? imgPath : path.resolve(process.cwd(), imgPath);
  const buf = fs.readFileSync(abs);
  const results = await altImageSearch(buf, { size: 10 });
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
