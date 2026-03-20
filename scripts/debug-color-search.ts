import { textSearch } from "../src/routes/search/search.service";

async function main() {
  const queries = ["hoodie", "white hoodie", "black hoodie"];

  for (const q of queries) {
    const res = await textSearch(q, undefined, { limit: 10, offset: 0, includeRelated: false } as any);
    const top = (res.results || []).slice(0, 10).map((r: any) => ({
      id: r.id,
      title: r.title,
      color: r.color ?? r.attr_color ?? null,
      sim: r.similarity_score ?? r.openSearchScore ?? null,
      rerankScore: r.rerankScore ?? null,
      match: r.match_type ?? null,
    }));

    console.log("\nQUERY:", q);
    console.log("TOTAL:", res.total);
    if (res.meta?.debug) {
      console.log("DEBUG:", {
        openSearchHitsTotal: res.meta.debug.openSearchHitsTotal,
        openSearchHitsCount: res.meta.debug.openSearchHitsCount,
        hasProductTypeConstraint: res.meta.debug.hasProductTypeConstraint,
        colorsForFilter: res.meta.debug.colorsForFilter,
        colorMode: res.meta.debug.colorMode,
      });
    }
    console.log("TOP:", top);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

