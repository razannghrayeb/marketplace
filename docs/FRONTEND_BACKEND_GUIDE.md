# Frontend–Backend Connection Guide

> **Purpose:** Reference for building a frontend that connects to the Fashion Marketplace API deployed on Render.  
> Last updated: March 17, 2026

---

## Render Deployment Architecture

The backend is split into **two Render Web Services**:

| Service | Name | Base URL | Role |
|---------|------|----------|------|
| **API Service** | `marketplace-api` | `https://marketplace-api.onrender.com` | Auth, cart, favorites, compare, try-on |
| **ML Service** | `marketplace-ml` | `https://marketplace-ml.onrender.com` | Search, products, images, wardrobe, ingest |

**Important:** When `SERVICE_ROLE=api`, the API service **proxies** ML routes to the ML service. So your frontend can use a **single base URL** (the API service) for all endpoints. The API service forwards `/search`, `/products`, `/api/images`, `/api/wardrobe`, etc. to the ML service.

**Recommended frontend base URL:**
```
https://marketplace-main.onrender.com
```

---

## Authentication

### JWT Flow

| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/api/auth/signup` | POST | `{ email, password }` | `{ accessToken, refreshToken, user }` |
| `/api/auth/login` | POST | `{ email, password }` | `{ accessToken, refreshToken, user }` |
| `/api/auth/refresh` | POST | `{ refreshToken }` | `{ accessToken, refreshToken }` |
| `/api/auth/me` | GET | — | `{ user }` (requires `Authorization: Bearer <accessToken>`) |
| `/api/auth/me` | PATCH | `{ email? }` or `{ password }` | Updated user |

- **Access token:** 15 min expiry. Send as `Authorization: Bearer <accessToken>`.
- **Refresh token:** 7 days. Use to get new access token when 401.
- **Protected routes:** Cart, favorites, wardrobe, try-on require auth.

---

## API Endpoints by Feature

### 1. Products (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products` | List products (pagination, filters: category, brand, min_price, max_price) |
| GET | `/products/facets` | Get filter options (categories, brands, price ranges) |
| GET | `/products/search?q=` | Text search by title |
| GET | `/products/:id` | Get single product by ID |
| GET | `/products/:id/recommendations` | ML-ranked similar products |
| GET | `/products/:id/complete-style` | Outfit completion suggestions |
| GET | `/products/:id/price-history` | Price history |
| GET | `/products/price-drops` | Recent price drops |
| GET | `/products/:id/images` | List product images |
| POST | `/products/recommendations/batch` | Batch recommendations |

### 2. Search (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/search?q=` | Semantic text search (NLP, intent, entities) |
| POST | `/search/image` | Single-image CLIP search (multipart: `image`) |
| POST | `/search/multi-image` | Multi-image + prompt composite search |
| POST | `/search/multi-vector` | Explicit attribute weights |
| GET | `/search/autocomplete?q=` | Autocomplete suggestions |
| GET | `/search/trending` | Trending queries |
| GET | `/search/popular` | Popular queries |

### 3. Image Analysis (Shop-the-Look)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/images/search` | Upload image → detect items → find similar per item |
| POST | `/api/images/search/url` | Same from image URL |
| POST | `/api/images/detect` | YOLO detection only |
| GET | `/api/images/labels` | Supported fashion categories |
| GET | `/api/images/status` | CLIP/YOLO service status |

### 4. Cart (Auth Required)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/cart` | — | Get cart items |
| POST | `/api/cart` | `{ productId, quantity }` | Add/update item |
| PATCH | `/api/cart/:productId` | `{ quantity }` | Update quantity (0 = remove) |
| DELETE | `/api/cart/:productId` | — | Remove item |
| DELETE | `/api/cart/clear` | — | Clear cart |

### 5. Favorites (Auth Required)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/favorites` | — | List favorites |
| POST | `/api/favorites/toggle` | `{ productId }` | Toggle favorite |
| GET | `/api/favorites/check/:productId` | — | Check if favorited |
| POST | `/api/favorites/check` | `{ productIds: [] }` | Batch check |

### 6. Wardrobe (Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wardrobe/items` | List wardrobe items |
| POST | `/api/wardrobe/items` | Add item (multipart: image, name, category_id, etc.) |
| GET | `/api/wardrobe/items/:id` | Get item |
| PATCH | `/api/wardrobe/items/:id` | Update item |
| DELETE | `/api/wardrobe/items/:id` | Delete item |
| GET | `/api/wardrobe/profile` | Style profile |
| GET | `/api/wardrobe/gaps` | Missing essentials |
| GET | `/api/wardrobe/recommendations` | Personalized recommendations |
| POST | `/api/wardrobe/outfit-suggestions` | Outfit suggestions |
| POST | `/api/wardrobe/complete-look` | Complete look from items |
| POST | `/api/wardrobe/analyze-photo` | YOLO + Gemini auto-categorize |
| POST | `/api/wardrobe/outfit-coherence` | 6-dim outfit quality score |

### 7. Virtual Try-On (Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tryon/` | Upload person + garment → 202, poll for result |
| POST | `/api/tryon/from-wardrobe` | Person + wardrobe_item_id |
| POST | `/api/tryon/from-product` | Person + product_id |
| POST | `/api/tryon/batch` | 1 person + up to 5 garments |
| GET | `/api/tryon/:id` | Poll job status |
| GET | `/api/tryon/history` | Job history |
| GET | `/api/tryon/saved` | Saved results |
| POST | `/api/tryon/:id/save` | Bookmark result |
| DELETE | `/api/tryon/:id` | Delete job |

### 8. Compare (Public)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/compare` | `{ product_ids: [1,2,3] }` | Multi-product comparison |

### 9. Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |
| GET | `/metrics` | Prometheus metrics |
| GET | `/` | Service info `{ ok, serviceRole, routes }` |

---

## Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

---

## Key Query Parameters

### Products List
- `page`, `limit`, `category`, `brand`, `min_price`, `max_price`, `sort`, `order`

### Search
- `q` (required for text search), `page`, `limit`, `category`, `brand`, `min_price`, `max_price`, `color`

### Image Search (multipart)
- `limit`, `threshold`, `confidence`, `limit_per_item`, `filter_category`

---

## CORS

Backend uses `CORS_ORIGIN` env var. Set it to your frontend origin (e.g. `https://your-app.vercel.app`) in Render dashboard. `*` allows all origins (dev only).

---

## Rate Limits

- Default: 100 req/min per IP
- Search: 60 req/min
- Image upload: 20 req/min
- ML: 40 req/min

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Frontend Checklist

- [ ] Set `VITE_API_URL` or `NEXT_PUBLIC_API_URL` to Render API URL
- [ ] Implement auth: signup/login, store tokens, refresh on 401
- [ ] Add `Authorization: Bearer <token>` for protected routes
- [ ] Handle multipart for image uploads (search, wardrobe, try-on)
- [ ] Poll try-on jobs: `GET /api/tryon/:id` until `status: completed` or `failed`
- [ ] Use Postman collection (`postman_collection.json`) for testing

---

## Postman Collection

Import `postman_collection.json` and set `baseUrl` to your Render API URL for quick testing.

---

## Known Gaps (No Backend Support Yet)

- No checkout/payment flow
- No `POST /api/auth/logout`
- No email verification
- No password reset
- Admin routes have no auth (internal use only)
