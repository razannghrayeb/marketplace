/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { dedupeSearchResults, filterRelatedAgainstMain } from "./resultDedup";

describe("dedupeSearchResults", () => {
  test("keeps one row per duplicate product id (best score wins)", () => {
    const out = dedupeSearchResults([
      { id: "1", similarity_score: 0.5, images: [{ url: "https://x/a.jpg", is_primary: true }] },
      { id: "1", similarity_score: 0.9, images: [{ url: "https://x/b.jpg", is_primary: true }] },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].similarity_score).toBe(0.9);
  });

  test("drops second product with same primary image URL", () => {
    const out = dedupeSearchResults([
      { id: "1", similarity_score: 0.9, images: [{ url: "https://cdn/x?w=1", is_primary: true }] },
      { id: "2", similarity_score: 0.8, images: [{ url: "https://cdn/x?w=2", is_primary: true }] },
    ]);
    expect(out.length).toBe(1);
    expect(String(out[0].id)).toBe("1");
  });

  test("can keep canonical siblings and near-pHash variants for text search", () => {
    const out = dedupeSearchResults(
      [
        {
          id: "1",
          canonical_id: "10",
          similarity_score: 0.9,
          images: [{ url: "https://cdn/x/a.jpg", is_primary: true, p_hash: "aaaa" }],
        },
        {
          id: "2",
          canonical_id: "10",
          similarity_score: 0.8,
          images: [{ url: "https://cdn/x/b.jpg", is_primary: true, p_hash: "aaab" }],
        },
      ],
      {
        collapseCanonicalGroups: false,
        collapseNearPHash: false,
      },
    );

    expect(out.length).toBe(2);
  });

  test("filterRelatedAgainstMain removes overlapping ids", () => {
    const main = [{ id: "1", similarity_score: 1, images: [] }];
    const rel = [
      { id: "1", similarity_score: 0.5, images: [] },
      { id: "2", similarity_score: 0.4, images: [] },
    ];
    const out = filterRelatedAgainstMain(main as any, rel as any);
    expect(out?.length).toBe(1);
    expect(String(out![0].id)).toBe("2");
  });
});
