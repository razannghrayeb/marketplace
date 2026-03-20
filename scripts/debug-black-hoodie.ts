import { textSearch } from "../src/routes/search/search.service";
import { processQuery } from "../src/lib/queryProcessor";
import { osClient } from "../src/lib/core/opensearch";
import { config } from "../src/config";

async function main() {
  process.env.SEARCH_DEBUG = "1";
  const raw = "black hoodie black";

  const ast = await processQuery(raw);
  console.log("AST.entities:", ast.entities);
  console.log("AST.searchQuery:", ast.searchQuery);

  const res: any = await textSearch(raw, undefined, { limit: 10, offset: 0, includeRelated: false });
  console.log("TOTAL:", res.total);

  const colorsForFilter = res.meta?.debug?.colorsForFilter ?? null;
  console.log("DEBUG.colorsForFilter:", colorsForFilter);
  console.log("DEBUG.colorMode:", res.meta?.debug?.colorMode);
  console.log("DEBUG.filterCount:", res.meta?.debug?.filterClausesCount);

  const top = (res.results || []).slice(0, 10);
  for (const r of top) {
    const id = String(r.id);
    let osDoc: any = null;
    try {
      const doc = await osClient.get({ index: config.opensearch.index, id });
      osDoc = doc.body?._source ?? doc.body;
    } catch {}

    console.log({
      id,
      title: r.title,
      returned_color: r.color,
      os_attr_color: osDoc?.attr_color ?? null,
      os_attr_colors: osDoc?.attr_colors ?? [],
      product_types: osDoc?.product_types ?? [],
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

