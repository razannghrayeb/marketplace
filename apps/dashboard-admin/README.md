# Dashboard Admin

An internal dashboard app for the scraper/Supabase product catalog in this repo.
Built as a separate Next.js app so it can sit cleanly alongside the existing Express + scraper backend.

---

## Stack

| Layer      | Tech                      |
|------------|---------------------------|
| Framework  | Next.js 14 (App Router)   |
| Language   | TypeScript (strict)       |
| Styling    | Tailwind CSS              |
| Database   | Supabase (PostgreSQL)     |
| Charts     | Recharts                  |
| Icons      | Lucide React              |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                  # Overview dashboard
│   ├── vendors/
│   │   ├── page.tsx              # Vendors list
│   │   └── [id]/page.tsx         # Vendor detail
│   ├── products/
│   │   └── page.tsx              # Products table + drawer
│   ├── audit/
│   │   └── page.tsx              # Quality audit
│   ├── variants/
│   │   └── page.tsx              # Variant inspector
│   ├── prices/
│   │   └── page.tsx              # Price history
│   ├── freshness/
│   │   └── page.tsx              # Freshness/coverage
│   └── api/
│       ├── products/             # Products API + price history
│       ├── variants/             # Variant lookup
│       └── variant-groups/       # Grouped variant API
├── components/
│   ├── layout/Sidebar.tsx        # Navigation
│   ├── ui/index.tsx              # KpiCard, Badge, Section, etc.
│   └── tables/ProductDrawer.tsx  # Product detail side panel
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Supabase browser + admin clients
│   │   └── database.types.ts     # Type stubs (replace with generated)
│   ├── queries/index.ts          # All Supabase queries
│   └── utils/quality.ts          # Flag detection, formatters
├── hooks/
│   └── useDebounce.ts
└── types/index.ts                # All TypeScript types
```

---

## Setup

### 1. Install

```bash
cd apps/dashboard-admin
npm install
```

### 2. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # optional but recommended
```

### 3. Run Supabase migrations

Open your Supabase project → **SQL Editor** → paste and run:

```
supabase/migrations/001_dashboard_rpcs.sql
```

This creates all RPCs used by the dashboard (KPIs, audit counts, variant groups, etc.)
and adds performance indexes.

### 4. Generate TypeScript types (recommended)

```bash
npx supabase gen types typescript \
  --project-id YOUR_PROJECT_ID \
  > src/lib/supabase/database.types.ts
```

### 5. Dev server

```bash
npm run dev
# -> http://localhost:3000
```

## Notes for This Repository

- This app expects the existing Supabase schema from `db/schema.sql`.
- The SQL in `supabase/migrations/001_dashboard_rpcs.sql` adds dashboard-focused RPCs and indexes only.
- Product IDs and vendor IDs in this project are numeric, and `products.image_urls` is `jsonb`.
- Some product quality checks are heuristic and are meant to help review scraper output, not mutate data automatically.

---

## Pages

| Route          | Description                                              |
|----------------|----------------------------------------------------------|
| `/`            | Overview KPIs + vendor/category charts                   |
| `/vendors`     | Vendor table with health scores                          |
| `/vendors/:id` | Vendor detail: stats, products, health breakdown         |
| `/products`    | Full product table, filters, search, product drawer      |
| `/prices`      | Price change events, discount leaderboard, volume chart  |
| `/freshness`   | Staleness breakdown by vendor                            |

---

## Quality Checks Implemented

**Critical:**
- Sale price > base price
- Price is zero

**Warning:**
- Color field looks like a size (XS/S/M/L/XL/numeric)
- Size field looks like a color (Black/Navy/Red/…)
- `image_url` null but `image_urls` populated
- `image_urls` empty but `image_url` exists
- Missing category
- Missing brand

**Stale:**
- Not seen > 14 days
- Not seen 7–14 days

**Info:**
- Duplicate `product_url`
- Orphan `variant_id` (no `parent_product_url`)
- Missing `return_policy`

---

## Performance Notes

- All heavy aggregations run as Supabase RPCs (single SQL round-trip)
- Products table uses server-side pagination (50 rows default, max 200)
- Price history and variants load lazily (only when drawer tab opens)
- Full-text search uses PostgreSQL GIN index on `title || brand`
- Indexes on `vendor_id`, `last_seen`, `category`, `availability`, `parent_product_url`

---

## Extending

**Add a new vendor:**
1. Insert into `vendors` table
2. No code changes needed — dashboard auto-picks it up

**Add user-facing analytics:**
The app tables (`favorites`, `cart_items`, `outfits`, etc.) are already in the same Supabase project.
Add new pages under `src/app/` following the same server component pattern.

