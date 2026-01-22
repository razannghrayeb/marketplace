import { testConnection } from "../src/lib/core/db";
import { runEshopgsCrawl } from "../src/lib/scrape/runEshopgs";

async function main() {
  console.log("1) Testing DB connection...");
  const ok = await testConnection();
  console.log("DB OK?", ok);

  if (!ok) {
    console.log("Database not reachable. Stop here.");
    process.exit(1);
  }

  console.log("2) Running eshopgs crawl for 1 product...");
  const result = await runEshopgsCrawl(1);
  console.log("Crawl result:", result);

  console.log("Done");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
