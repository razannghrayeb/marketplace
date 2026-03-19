# StyleAI Marketplace — Consumer Frontend

Next.js 14 consumer-facing app for the Fashion AI Marketplace. Connects to the backend API (Google Cloud Run).

> **Note:** We are still working on the design. UI and styling may change.

---

## What This Contains

- **Home** — Hero, feature highlights, product grid
- **Discover** — Text search, image search, **Shop the look** (YOLO: detect items in outfit photo → find similar products)
- **Shop** — Browse products, filter by category/brand
- **Product detail** — Full product view, **Complete the look** (outfit recommendations)
- **Compare** — Select 2–5 products, compare quality/price/features
- **Wardrobe** — Upload clothes, manage items (auth required)
- **Virtual Try-On** — Upload person + garment photos, AI try-on (auth required)
- **Favorites** — Saved products (auth required)
- **Auth** — Signup, login, JWT with refresh
- **Dashboard** — Business seller dashboard (stats, products, analytics)

---

## How to Run the Frontend Locally

```bash
# From repo root
pnpm install

# Create apps/marketplace/.env.local (copy from .env.local.example)
# Set NEXT_PUBLIC_API_URL to your backend API URL

# Run dev server (port 3001)
pnpm --filter marketplace dev
```

Open [http://localhost:3001](http://localhost:3001).

---

## How to Run the Backend Locally

The backend is a Node.js/Express API. You need:

- **PostgreSQL** (or Supabase `DATABASE_URL`)
- **OpenSearch** (Aiven or similar)
- **Upstash Redis** (optional, for queue)
- **Supabase** (auth, storage)
- **R2 / S3** (for images)
- **Secrets** from Google Secret Manager (e.g. `DATABASE_URL`, `SUPABASE_*`, `OS_NODE`, etc.)

```bash
# From repo root
pnpm install

# Create .env (see .env.example)
# Required: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OS_NODE

# Run API (port 4000)
pnpm dev
```

Or use the deployed API: `https://marketplace-933737368483.europe-west1.run.app`

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (e.g. `https://marketplace-933737368483.europe-west1.run.app`) |

---

## Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your Git repo
2. **Configure project:**
   - **Root Directory:** `apps/marketplace` (click Edit, set to `apps/marketplace`)
   - **Framework Preset:** Next.js (auto-detected)
   - **Build Command:** `cd ../.. && pnpm install && pnpm --filter marketplace build`
   - **Output Directory:** `.next`
   - **Install Command:** `cd ../.. && pnpm install`
3. **Environment variables:** Add `NEXT_PUBLIC_API_URL` = your backend URL (e.g. `https://marketplace-933737368483.europe-west1.run.app`)
4. Click **Deploy**

---

## Scripts

- `pnpm dev` — Start dev server on port 3001
- `pnpm build` — Production build
- `pnpm start` — Production server
