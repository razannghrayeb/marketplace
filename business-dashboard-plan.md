# Business Dashboard — Project Plan

**Project:** Fashion Marketplace — Vendor Business Dashboard
**Branch:** mariam-work
**Developer:** Mariam

---

## Overview

We are building a business dashboard that allows vendors to monitor the health of their listed products. The dashboard calculates a **Dead Stock Risk (DSR) score** for each product based on data we already collect through our scrapers. No sales or cart data is required — the score is calculated from listing behavior and price patterns.

---

## What is the DSR Score?

The DSR (Dead Stock Risk) score is a number from 0 to 100 that measures how likely a product is to become unsold dead stock.

```
0  - 33  → GREEN  — Product is healthy
34 - 66  → YELLOW — Product is at risk, needs monitoring  
67 - 100 → RED    — Product is critical, needs immediate action
```

It is calculated from 5 signals using data we already have in our database:

| Signal | Weight | Data Source |
|--------|--------|-------------|
| Listing Age | 30% | `products.last_seen` |
| Price Movement | 25% | `price_history` table |
| Category Velocity | 25% | `products.category` |
| Search Visibility | 15% | OpenSearch rankings |
| Quality Score | 5% | `product_quality_scores` table |

**Important note:** We do not have access to sales or cart data. The DSR score is based entirely on listing behavior and price patterns. This is clearly communicated to vendors on the dashboard.

---

## Step 1 — Backend API (Mariam's work)

### What it is
The backend API is the engine behind the dashboard. It reads data from the database, calculates the DSR score for each product, and sends the results to the frontend to display.

### What needs to be built

**Endpoint 1 — Summary Cards**
```
GET /api/dashboard/summary

Returns:
- Total number of products at risk (DSR 34-66)
- Total number of critical products (DSR 67-100)
- Estimated value at risk (sum of prices of at-risk products)
- Number of alerts resolved this week
```

**Endpoint 2 — Product List with DSR Scores**
```
GET /api/dashboard/products

Returns for each product:
- Product ID, name, image, category
- DSR score (0-100)
- Risk level (green / yellow / red)
- Days listed
- Top risk reason (one sentence explaining the biggest problem)
- Quick action button label
```

**Endpoint 3 — Signal Breakdown for One Product**
```
GET /api/dashboard/products/:id/signals

Returns the breakdown of all 5 signals:
- Listing age score + plain English explanation
- Price movement score + plain English explanation
- Category velocity score + plain English explanation
- Search visibility score + plain English explanation
- Quality score + plain English explanation
```

**Endpoint 4 — Alerts List**
```
GET /api/dashboard/alerts

Returns list of active alerts:
- Alert type (early_risk / critical / recovery)
- Product name and ID
- Alert message
- Recommended action buttons
- Date created
```

**Endpoint 5 — Dismiss an Alert**
```
POST /api/dashboard/alerts/:id/dismiss

Marks an alert as dismissed so it no longer appears
```

### Database table needed
A new table `vendor_alerts` needs to be added to the schema:
```sql
CREATE TABLE vendor_alerts (
  id SERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id),
  alert_type TEXT,        -- 'early_risk', 'critical', 'recovery'
  message TEXT,
  dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### How DSR is calculated (logic)
```
1. Get product from database
2. Calculate each signal score (0-100):
   - Listing age: more days = higher score
   - Price movement: more drops = higher score
   - Category velocity: fewer new products in category = higher score
   - Search visibility: lower search rank = higher score
   - Quality score: lower quality score = higher score
3. Combine: DSR = (age×0.30) + (price×0.25) + (category×0.25) + (search×0.15) + (quality×0.05)
4. Label: 0-33 green, 34-66 yellow, 67-100 red
```

---

## Step 2 — Frontend Dashboard Page (Frontend teammate's work)

### What it is
The visual page that vendors see when they log in. It takes the data from the backend API (Step 1) and displays it in a clear, actionable way.

### What the page includes

**Section A — Summary Header (4 stat cards)**
```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  12 At Risk     │ │  3 Critical     │ │  $4,200 At Risk │ │  5 Resolved     │
│  products       │ │  products       │ │  estimated value│ │  this week      │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```
Data comes from: `GET /api/dashboard/summary`

---

**Section B — Filter Bar**
```
Risk:     [All]  [At Risk]  [Critical]
Category: [All Categories ▼]
Sort:     [Highest Risk ▼]
```
Filters apply instantly with no page reload.

---

**Section C — Product Table**
```
┌──────────┬────────────────────┬──────────┬────────┬───────────────┐
│ Image    │ Product Name       │ DSR Score│ Days   │ Action        │
├──────────┼────────────────────┼──────────┼────────┼───────────────┤
│ [img]    │ Silk Wrap Dress    │ 🔴 84    │ 52     │ [Take Action] │
│ [img]    │ Linen Blazer       │ 🟡 61    │ 38     │ [Take Action] │
│ [img]    │ White Sneakers     │ 🟢 22    │ 8      │               │
└──────────┴────────────────────┴──────────┴────────┴───────────────┘
```
Clicking any row opens the signal breakdown below it.
Data comes from: `GET /api/dashboard/products`

---

**Section D — Signal Breakdown Drawer**
Opens inline below the clicked product row. Shows all 5 signals as progress bars with plain English explanations.
```
Listing Age        [████████████████░░░░] 52 days — category median is 28 days
Price Movement     [████████████░░░░░░░░] 2 markdowns with no recovery
Category Velocity  [████████░░░░░░░░░░░░] Dresses down 18% in search this week
Search Visibility  [████░░░░░░░░░░░░░░░░] Ranks low for relevant search terms
Quality Score      [████████████████████] Good description and images ✓
```
Data comes from: `GET /api/dashboard/products/:id/signals`

---

**Section E — Alerts Panel**
A slide-over panel that opens from the sidebar. Shows unread alerts grouped by severity.
```
🔴 Critical — "Linen Blazer, Camel, Size M"
   Listed 74 days. Price marked down twice with no recovery.
   Quality score: 38/100 — description missing fabric and size info.
   [Fix the listing] [Run 30% markdown] [Bundle with similar] [Hide]

🟠 Early Risk — "Silk Wrap Dress, Black"
   Listed 38 days, 12 days over category median.
   Category trending down 18% in searches this week.
   [Suggest markdown] [See similar products' performance] [Dismiss]

🔵 Recovery — "Chunky Knit Sweater, Cream"
   Was at risk last week. Knitwear searches up 34% this week.
   Your window to recover without a markdown is now.
   [Update listing title] [See trending search terms]
```
Data comes from: `GET /api/dashboard/alerts`

---

**Section F — Empty State**
When no products are at risk:
```
✅ All your products are healthy
   Last checked: Today at 00:00
```

---

## Step 3 — Alert Generation (Mariam's work — runs after Step 1)

### What it is
An automated background process that runs every night alongside the scraper. It checks every product's DSR score and creates alerts automatically when thresholds are crossed.

### How it works
```
Every night at midnight:
1. Nightly crawl runs → fresh product data saved to database
2. Alert generator runs immediately after
3. For every product:
   - Calculate DSR score
   - If DSR > 50 and no recent alert → create EARLY RISK alert
   - If DSR > 75 and no recent alert → create CRITICAL alert
   - If product was risky but category recovered → create RECOVERY alert
4. Alerts saved to vendor_alerts table
5. Old dismissed alerts cleaned up
```

### The 3 alert types in detail

**Early Risk (orange)**
- Triggered when: DSR score crosses 50
- Message template: "This product has been listed {X} days — {Y} days longer than the median for {category}. Category is trending down {Z}% in searches."
- Actions offered: Suggest markdown, See similar products, Dismiss

**Critical (red)**
- Triggered when: DSR score crosses 75
- Message template: "Listed {X} days. Price marked down {Y} times with no recovery. Quality score {Z}/100."
- Actions offered: Fix listing, Run 30% markdown, Bundle with similar items, Hide from catalog

**Recovery Opportunity (blue)**
- Triggered when: Product DSR was above 50 last week AND category search volume increased by more than 20% this week
- Message template: "This product was at risk but {category} searches are up {X}% this week. Your window to recover without a markdown is now."
- Actions offered: Update listing title, See trending search terms

---

## What Each Team Member Needs to Do

| Task | Who | Depends on |
|------|-----|-----------|
| Build 5 API endpoints | Mariam | Nothing — start now |
| Add `vendor_alerts` table to schema | Mariam | Nothing — start now |
| Build dashboard frontend page | Frontend teammate | Step 1 done |
| Build alert generation logic | Mariam | Step 1 done |
| Connect alerts to nightly worker | Mariam | Step 3 done |

---

## Important Notes for the Team

1. **No sales data available** — DSR score is based on listing behavior and price patterns only. This is by design and clearly labeled on the dashboard.

2. **Data we already have** — No new data collection is needed. Everything required exists in the current database tables.

3. **API must be done first** — The frontend cannot start until the backend endpoints are working and tested.

4. **Start simple** — Build the product table with DSR scores first. Add alerts after the table works correctly.

---

