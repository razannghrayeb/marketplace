import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";
import { pg } from "../src/lib/core/db";

async function main() {
  const ids = ["23534", "24529", "24542", "24596"];
  for (const id of ids) {
    console.log("\n--- OpenSearch doc for id:", id, "---");
    try {
      const docResp = await osClient.get({ index: config.opensearch.index, id });
      const src: any = docResp.body?._source ?? docResp.body;
      console.log({
        attr_color: src?.attr_color ?? null,
        attr_colors: src?.attr_colors ?? [],
        product_types: src?.product_types ?? [],
        title: src?.title ?? null,
        embedding_has: Array.isArray(src?.embedding) && src.embedding.length > 0,
      });
    } catch (e: any) {
      console.error("OpenSearch get failed:", e?.message ?? e);
    }

    console.log("--- Postgres product for id:", id, "---");
    try {
      const r = await pg.query(
        `SELECT id, title, brand, category, color, gender, size, availability, price_cents, last_seen
         FROM products WHERE id = $1`,
        [id]
      );
      console.log(r.rows[0] ?? null);
    } catch (e: any) {
      console.error("PG query failed:", e?.message ?? e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

