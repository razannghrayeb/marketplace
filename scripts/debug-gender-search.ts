import { textSearch } from "../src/routes/search/search.service";

async function main() {
  const queries = ["men hoodie", "women hoodie"];

  for (const q of queries) {
    const res = await textSearch(q, undefined, { limit: 10, offset: 0, includeRelated: false } as any);
    const top = (res.results || []).slice(0, 10).map((r: any) => ({
      id: r.id,
      title: r.title,
      attr_gender: r.attr_gender ?? null,
      match: r.match_type ?? null,
      sim: r.similarity_score ?? null,
    }));

    console.log("\nQUERY:", q);
    console.log("TOTAL:", res.total);
    console.log("TOP:", top);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

