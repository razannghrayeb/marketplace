# Color-Only Repair Script

## Overview

Created **[scripts/repair-opensearch-colors.ts](scripts/repair-opensearch-colors.ts)** to fix color fields in OpenSearch for products that already have embeddings **without re-computing vectors**.

## What It Does

1. **Reads product colors from PostgreSQL** (`products.color`)
2. **Fetches existing OpenSearch documents** by product ID
3. **Normalizes DB colors** to canonical fashion tokens (e.g., "light green" → "green")
4. **Updates ONLY color fields** while preserving:
   - All embeddings (`embedding`, `embedding_garment`)
   - All attribute embeddings (`embedding_color`, `embedding_texture`, etc.)
   - All other indexed fields
5. **Bulk-indexes updates** back to OpenSearch efficiently

## Color Fields Updated

- `attr_color` — primary color for display
- `attr_colors` — normalized colors array (BM25)
- `color_primary_canonical` — canonical fashion token
- `color_secondary_canonical`, `color_accent_canonical`
- `color_palette_canonical` — full palette
- `color_confidence_primary` — set to 0.7 (DB source confidence)
- `color_confidence_text` — set to 0.7
- `attr_color_source` — marked as "catalog" (DB source)

## Usage

```bash
# Repair all products with color values (dry-run first)
npx tsx scripts/repair-opensearch-colors.ts --dry-run

# Actually repair all
npx tsx scripts/repair-opensearch-colors.ts

# Limit to first 100 products
npx tsx scripts/repair-opensearch-colors.ts --limit 100

# Repair only one category
npx tsx scripts/repair-opensearch-colors.ts --category dresses

# Combine options
npx tsx scripts/repair-opensearch-colors.ts --category dresses --limit 50 --dry-run
```

## Output

- Console logs showing progress:
  - Products found with color values in DB
  - Products fetched from OpenSearch
  - Products updated (those with embeddings)
  - Errors and skips
- Stats file saved to `./tmp/repair-colors-stats.json`

## Example Stats

```json
{
  "processed": 500,
  "updated": 485,
  "skipped": 15,
  "errors": 0,
  "startTime": 1234567890123,
  "endTime": 1234567891000
}
```

- **processed**: Total products with DB color values checked
- **updated**: Successfully updated in OpenSearch
- **skipped**: Products not found in OpenSearch or missing embeddings
- **errors**: Any errors during processing

## Color Normalization

The script maps input colors to canonical fashion tokens:

- **Hex colors**: `#FF5733` → canonical via LAB distance
- **CSS names**: `light blue` → `light-blue`
- **Canonical tokens**: Matched directly
- **Custom mappings**: e.g., "wine" → "burgundy"

## Why This Approach?

✅ **Non-destructive** — embeddings and vectors preserved  
✅ **Fast** — no image re-processing, no CLIP/BLIP re-computation  
✅ **Efficient** — bulk indexing (50 docs/buffer)  
✅ **Safe** — dry-run mode to preview changes  
✅ **Targeted** — only updates color metadata

## Integration with Recent Fixes

This script complements the color priority fix in [src/lib/search/searchDocument.ts](src/lib/search/searchDocument.ts):

- **Merge logic now prioritizes**: DB color > image color > text color
- **New indexing uses `catalogColor`**: See [scripts/resume-reindex.ts](scripts/resume-reindex.ts#L660)
- **This repair script**: Fixes existing indexed documents retroactively

## Example: Fixing Product 24542

Before repair:

```
OpenSearch: attr_color = "gray"
PostgreSQL: color = "light green"
```

After repair:

```
OpenSearch:
  - attr_color = "green"
  - color_primary_canonical = "green"
  - attr_color_source = "catalog"
  - color_confidence_primary = 0.7
  - All embeddings preserved ✓
```

## Environment Requirements

- `DATABASE_URL` — PostgreSQL connection
- `OS_NODE` — OpenSearch endpoint
- `OS_INDEX` — OpenSearch index name (defaults to "products")
