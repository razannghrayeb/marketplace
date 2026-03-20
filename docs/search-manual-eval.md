# Manual search evaluation checklist

Use after changing retrieval or ranking.

## Text

1. **Category aisles** — Query: `accessories`, `tops`, `bags`, `shoes`, `dresses`. Results should stay in the expected aisle (no tops mixed into accessories unless strict mode is off and query is not category-dominant).
2. **Strict mode** — Set `SEARCH_STRICT_CATEGORY_DEFAULT=true`, repeat aisle queries; every result’s `category` / `category_canonical` should match the intended family.
3. **Garment terms** — `hoodie`, `blue jeans`, `white sneakers`: types and colors should rank above generic matches.
4. **Dedup** — Run a broad query; confirm no duplicate `id` and no two rows with the same primary image URL.

## Image

1. **Upload** — Use a clear product photo; results should be visually similar, not merely same broad category.
2. **Threshold** — Lower `CLIP_SIMILARITY_THRESHOLD` if recall is too low; raise if junk appears.
3. **Dedup** — Confirm no duplicate products or identical primary images in the first page.

## Regression

- Run TypeScript build: `npm run build`.
- Optional: load `*.unit.ts` files in your IDE test runner if configured.
