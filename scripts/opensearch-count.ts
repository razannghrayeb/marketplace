/**
 * Count documents in the products OpenSearch index matching a "jeans-like" signal.
 *
 * Usage:
 *   pnpm run os:count
 *   pnpm run os:count -- jean
 *   pnpm run os:count -- denim
 *
 * Matches: category wildcard *needle*, category.search (text), product_types term "jeans"
 * when needle relates to jeans, or term product_types === needle.
 */

import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function main() {
  const needle = (process.argv[2] || "jean").toLowerCase().trim();
  const { osClient } = await import("../src/lib/core/opensearch");
  const { config } = await import("../src/config");

  const index = config.opensearch.index;

  const jeansTypeTerms =
    needle.includes("jean") || needle === "denim"
      ? [{ term: { product_types: "jeans" } }]
      : [{ term: { product_types: needle } }];

  const body = {
    query: {
      bool: {
        filter: [{ term: { is_hidden: false } }],
        should: [
          { wildcard: { category: `*${needle}*` } },
          { match: { "category.search": { query: needle, operator: "and" as const } } },
          ...jeansTypeTerms,
          { match: { title: { query: needle, operator: "and" as const } } },
        ],
        minimum_should_match: 1,
      },
    },
  };

  const res = await osClient.count({ index, body });

  const count =
    typeof res.body === "object" && res.body !== null && "count" in res.body
      ? (res.body as { count: number }).count
      : (res as { body?: { count?: number } }).body?.count;

  console.log(JSON.stringify({ index, needle, count, note: "OR across category/title/product_types" }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
