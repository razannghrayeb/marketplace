import "dotenv/config";
import { pg } from "../src/lib/core/db";
import { mapHexToFashionCanonical } from "../src/lib/color/garmentColorPipeline";

const CANONICAL_COLORS = new Set([
  "black", "white", "off-white", "cream", "ivory", "beige", "brown", "camel", "tan",
  "gray", "charcoal", "silver", "navy", "blue", "light-blue", "green", "olive", "red",
  "burgundy", "pink", "purple", "yellow", "orange", "gold", "teal", "multicolor",
]);

const ALIAS_MAP: Record<string, string> = {
  "light blue": "light-blue",
  "sky blue": "light-blue",
  "baby blue": "light-blue",
  "dark blue": "navy",
  "light green": "green",
  "dark green": "green",
  "light gray": "silver",
  "light grey": "silver",
  "dark gray": "charcoal",
  "dark grey": "charcoal",
  "light brown": "tan",
  "dark brown": "brown",
  "light pink": "pink",
  "hot pink": "pink",
  "light purple": "purple",
  "dark purple": "purple",
  "light yellow": "yellow",
  "light orange": "orange",
  "dark orange": "orange",
  "light red": "red",
  "dark red": "burgundy",
  "wine": "burgundy",
  "maroon": "burgundy",
  "forest green": "olive",
  "sage": "olive",
  "bronze": "brown",
  "rust": "burgundy",
  "khaki": "tan",
  "neutral": "beige",
  "sand": "beige",
  "nude": "beige",
  "blush": "pink",
};

function normalizeColorToCanonical(colorStr: string | null): string | null {
  if (!colorStr) return null;

  const raw = String(colorStr).trim().toLowerCase();
  if (!raw) return null;

  if (raw.startsWith("#") || /^[0-9a-f]{6}$/i.test(raw)) {
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    const canonical = mapHexToFashionCanonical(hex);
    if (canonical) return canonical;
  }

  if (CANONICAL_COLORS.has(raw)) return raw;
  if (ALIAS_MAP[raw]) return ALIAS_MAP[raw];
  return raw;
}

async function main() {
  const result = await pg.query(
    `SELECT LOWER(TRIM(color)) AS color, COUNT(*)::int AS n
     FROM products
     WHERE color IS NOT NULL
       AND TRIM(color) <> ''
     GROUP BY LOWER(TRIM(color))
     ORDER BY COUNT(*) DESC, LOWER(TRIM(color)) ASC`
  );

  type Row = { color: string; n: number };
  const rows = result.rows as Row[];

  const mappedToCanonical: Array<{ source: string; mapped: string; n: number; rule: string }> = [];
  const passthrough: Array<{ source: string; mapped: string; n: number }> = [];
  const canonicalTotals = new Map<string, number>();

  for (const row of rows) {
    const source = row.color;
    const mapped = normalizeColorToCanonical(source) ?? "";

    let rule = "passthrough";
    if (source.startsWith("#") || /^[0-9a-f]{6}$/i.test(source)) rule = "hex";
    if (CANONICAL_COLORS.has(source)) rule = "canonical";
    if (ALIAS_MAP[source]) rule = "alias";

    if (CANONICAL_COLORS.has(mapped)) {
      mappedToCanonical.push({ source, mapped, n: row.n, rule });
      canonicalTotals.set(mapped, (canonicalTotals.get(mapped) ?? 0) + row.n);
    } else {
      passthrough.push({ source, mapped, n: row.n });
    }
  }

  const totalDistinct = rows.length;
  const totalProductsWithColor = rows.reduce((s, r) => s + r.n, 0);
  const canonicalDistinct = mappedToCanonical.length;
  const passthroughDistinct = passthrough.length;
  const canonicalProducts = mappedToCanonical.reduce((s, r) => s + r.n, 0);
  const passthroughProducts = passthrough.reduce((s, r) => s + r.n, 0);

  console.log("=== Color Mapping Audit ===");
  console.log(`Distinct DB colors: ${totalDistinct}`);
  console.log(`Products with non-empty color: ${totalProductsWithColor}`);
  console.log(`Mapped to canonical (distinct): ${canonicalDistinct}`);
  console.log(`Pass-through/non-canonical (distinct): ${passthroughDistinct}`);
  console.log(`Mapped to canonical (products): ${canonicalProducts}`);
  console.log(`Pass-through/non-canonical (products): ${passthroughProducts}`);

  const topCanonical = Array.from(canonicalTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log("\nTop canonical totals:");
  for (const [k, n] of topCanonical) {
    console.log(`  ${k}: ${n}`);
  }

  const topPassthrough = passthrough
    .sort((a, b) => b.n - a.n)
    .slice(0, 50);

  console.log("\nTop pass-through (needs alias mapping if you want canonical only):");
  for (const item of topPassthrough) {
    console.log(`  ${item.source} -> ${item.mapped} (${item.n})`);
  }

  const sampleMappings = mappedToCanonical
    .sort((a, b) => b.n - a.n)
    .slice(0, 50);

  console.log("\nTop mapped examples:");
  for (const item of sampleMappings) {
    if (item.source === item.mapped && item.rule === "canonical") continue;
    console.log(`  ${item.source} -> ${item.mapped} (${item.n}) [${item.rule}]`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
