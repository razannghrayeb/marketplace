#!/usr/bin/env tsx
import * as fs from "fs";
import path from "path";
import { rerankByColor, Candidate } from "./color-rerank";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: npx tsx scripts/demo-rerank.ts <queryImagePath> <candidates.json> [--w=0.2] [--sigma=20]");
    process.exit(1);
  }
  const queryImage = args[0];
  const candidatesPath = args[1];
  const opts: any = {};
  for (const a of args.slice(2)) {
    if (a.startsWith("--w=")) opts.w = parseFloat(a.split("=")[1]);
    if (a.startsWith("--sigma=")) opts.sigma = parseFloat(a.split("=")[1]);
  }

  if (!fs.existsSync(queryImage)) {
    console.error(`Query image not found: ${queryImage}`);
    process.exit(1);
  }

  if (!fs.existsSync(candidatesPath)) {
    console.error(`Candidates file not found: ${candidatesPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(candidatesPath, "utf-8");
  const candidates: Candidate[] = JSON.parse(raw);

  const results = await rerankByColor(queryImage, candidates, opts);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
