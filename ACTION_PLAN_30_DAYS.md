# 🎯 Action Plan — Next 30 Days

**Updated:** March 17, 2026 (Per Full Code Audit)

This tactical implementation plan prioritizes **production-critical fixes** and **high-impact missing features**.

---

## ⚠️ URGENT: Week 1 — Critical Bug Fixes (< 2 hours)

### Must Complete Before Any Deployment

**Status:** All 5 bugs are quick fixes. Estimated: **90 minutes total**

```
Priority 1 (1 min): Fix hardcoded NODE_ENV
├─ File: src/server.ts:36
├─ Remove: process.env.NODE_ENV = "test"
├─ Issue: OpenSearch index never initializes
└─ Impact: Search/recommendations completely broken without fix

Priority 2 (5 min): Protect admin routes
├─ File: src/routes/admin/index.ts
├─ Add: requireAuth + requireAdmin middleware to all routes
├─ Issue: Any user can hide/delete/merge products
└─ Impact: Data integrity, moderation bypass

Priority 3 (10 min): Create missing cart migration
├─ File: db/migrations/005a_cart_items.sql
├─ Create: cart_items table schema
├─ Issue: Fresh DB deployments will fail
└─ Impact: Cannot onboard new instances

Priority 4 (5 min): Fix migration conflicts
├─ Files: db/migrations/006_*.sql (3 files with same prefix)
├─ Action: Rename to 006a, 006b, 006c (sequential order)
├─ Issue: Migrations run out of order
└─ Impact: Database schema corruption

Priority 5 (1 min): Set JWT secret
├─ File: .env (must set JWT_SECRET)
├─ Issue: Default is "change-me-in-production"
├─ Impact: Stolen tokens valid for 7 days if not changed
└─ Action: Generate strong secret, document in .env.example
```

### Testing After Fixes
```bash
npm run build          # Should pass (no TypeScript errors)
npm run dev           # Should start without errors
curl http://localhost:4000/health  # Should respond
```

---

## Week 1: Bug Fixes + Validation

### Day 1: Fix Critical Bugs (90 mins)
- [ ] Remove hardcoded NODE_ENV from server.ts
- [ ] Add auth middleware to /admin routes
- [ ] Create cart_items migration (005a)
- [ ] Fix migration naming (006a, 006b, 006c)
- [ ] Generate + set JWT_SECRET in .env
- [ ] Test: `npm run build && npm run dev`
- [ ] Verify: `curl /health` returns 200 OK

### Day 2: Database Validation
- [ ] Run all migrations in order
- [ ] Verify schema created successfully
- [ ] Check OpenSearch index initialization
- [ ] Confirm cart, wardrobe, tryon tables exist

### Day 3: Smoke Tests
- [ ] Auth: signup → login → refresh token
- [ ] Cart: add item → get cart → remove item
- [ ] Search: text search, image search, multi-image
- [ ] Wardrobe: create item → analyze → get coherence
- [ ] Try-On: submit job → poll status

---

## Week 2: High-Priority Missing Features

### Feature 1: User Logout + Token Revocation (4 hours)

**Why:** Currently stolen re Fresh tokens are valid for 7 days with no revocation

**Implementation:**
```sql
-- Create refresh_token_blacklist table
CREATE TABLE refresh_token_blacklist (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  token_jti VARCHAR(255) NOT NULL UNIQUE,  -- JWT ID
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_blacklist_expires ON refresh_token_blacklist(expires_at);
```

**API Changes:**
- `POST /api/auth/logout` — Add refresh token to blacklist
- Update `refreshTokens()` to check blacklist
- Clear blacklist entries daily (cron job)

**Files to Create:**
- Migration: `db/migrations/008_refresh_token_blacklist.sql`
- Service: `src/lib/auth/tokenBlacklist.ts`

**Testing:**
- [ ] Login → get tokens
- [ ] Logout → refresh token fails
- [ ] Verify 401 Unauthorized on logout

---

### Feature 2: Checkout & Payment Flow (12 hours)

**Why:** Cart is a dead-end; no way to complete purchases

**Database Changes:**
```sql
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',  -- pending, paid, shipped, delivered
  total_cents BIGINT NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  payment_intent_id VARCHAR(255),  -- Stripe ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price_cents BIGINT NOT NULL  -- Lock price at purchase time
);
```

**API Endpoints:**
- `POST /api/checkout` — Validate cart → create Stripe intent → return client_secret
- `POST /api/checkout/confirm` — Confirm payment → create order
- `GET /api/orders` — List user's orders
- `GET /api/orders/:id` — Order details + tracking

**Stripe Integration:**
- Install `npm install stripe @stripe/react-stripe-js`
- Add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` to env
- Webhook handler for `payment_intent.succeeded`

**Files to Create:**
- Migration: `db/migrations/009_orders.sql`
- Service: `src/routes/checkout/checkout.service.ts`
- Controller: `src/routes/checkout/checkout.controller.ts`
- Routes: `src/routes/checkout/checkout.routes.ts`
- Stripe client: `src/lib/stripe.ts`

---

### Feature 3: Email Verification & Password Reset (6 hours)

**Why:** Users can't verify accounts or reset forgotten passwords

**Database Changes:**
```sql
CREATE TABLE email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**API Endpoints:**
- `POST /api/auth/verify-email` — Verify email token
- `POST /api/auth/resend-verification` — Resend verification email
- `POST /api/auth/forgot-password` — Request reset email
- `POST /api/auth/reset-password` — Confirm password reset

**Email Service:**
- Integrate SendGrid or AWS SES
- Email templates: verification, password-reset
- Add `EMAIL_SERVICE_PROVIDER` + API key to env

**Files to Create:**
- Migration: `db/migrations/010_email_verification.sql`
- Service: `src/lib/email.ts`
- Auth modifications: `src/routes/auth/auth.service.ts` + `controller.ts`

---

## Week 3: Medium-Priority Features + Testing

### Feature 1: Try-On Frontend UI (6 hours)

**Why:** Backend is complete; users have no way to use virtual try-on (SPA-only)

**Build:**
- React component: `apps/admin-dashboard/src/components/TryOn.tsx`
  - File upload (person photo)
  - Garment selection (carousel from product catalog or wardrobe)
  - Job status polling
  - Before/after comparison
  - Save / favorite results

**Files to Create:**
- Component: `apps/admin-dashboard/src/app/tryon/page.tsx`
- Hooks: `useVirtualTryOn()` (submit, poll, save)
- API client: `apps/admin-dashboard/src/lib/api/tryon.ts`

---

### Feature 2: A/B Testing Framework (4 hours)

**Why:** Can't measure ranking experiments; no way to compare search improvements

**Implementation:**
```typescript
// src/lib/experimentation/abTest.ts
interface ABTest {
  id: string;
  name: string;
  variants: {
    control: { rankerWeights: {...} };
    treatment: { rankerWeights: {...} };
  };
  allocation: number;  // % users in treatment
  start_date: Date;
  end_date?: Date;
}

function getVariant(userId: number, test: ABTest) {
  // Hash user ID to consistently assign to variant
  return userId % 100 < test.allocation ? 'treatment' : 'control';
}
```

**Database:**
```sql
CREATE TABLE ab_tests (
  id VARCHAR(50) PRIMARY KEY,
  name TEXT NOT NULL,
  variants JSONB NOT NULL,  -- control + treatment config
  allocation NUMERIC(3,2),  -- 0-1 allocation ratio
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE ab_test_events (
  id SERIAL PRIMARY KEY,
  test_id VARCHAR(50) REFERENCES ab_tests(id),
  user_id INT NOT NULL,
  variant VARCHAR(20),  -- control / treatment
  event_type VARCHAR(50),  -- view, click, purchase
  metric NUMERIC,  -- e.g., click count
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**API:**
- `GET /api/ab-tests` — List active tests
- `POST /api/ab-tests` — Create new test
- `GET /api/ab-tests/:id/results` — Get test results (NDCG, CTR, conversion)

---

### Feature 3: Comprehensive Test Suite (8 hours)

**Why:** Only manual tests exist; no automated CI validation

**Setup:**
```bash
npm install --save-dev jest @types/jest ts-jest
npx jest --init
```

**Tests to Write:**
- Auth: signup, login, refresh, logout, token blacklist
- Cart: add, update, remove, clear, totals
- Search: text, image, multi-image, autocomplete, trending
- Wardrobe: CRUD, coherence, layering, compatibility
- Try-On: submit, poll, status, cancel, save
- Recommendations: CLIP candidates, XGBoost ranking

**Target:** 80% code coverage for core business logic

**Files to Create:**
- `__tests__/auth.test.ts`
- `__tests__/cart.test.ts`
- `__tests__/search.test.ts`
- `__tests__/wardrobe.test.ts`
- `jest.config.ts`

---

## Week 4: Infrastructure & Performance

### 1. Automated Model Retraining (4 hours)

**Why:** XGBoost ranker goes stale; no continuous improvement

**Pipeline:**
```typescript
// scripts/retrain-ranker.ts (run weekly via cron)
async function retrainRanker() {
  const trainingData = await collectTrainingData();  // From recommendation_impressions
  const model = await trainXGBoost(trainingData);
  await saveModel(model);
  await notifyDeploymentTeam();
}
```

**Deploy:**
- Kubernetes CronJob (weekly at 2 AM UTC)
- Or AWS Lambda (weekly)
- With model versioning + rollback capability

---

### 2. Monitoring & Alerting (3 hours)

**Add:**
- Prometheus metrics for search quality (NDCG, MAP)
- Dashboard: search latency, error rates, cache hit rates
- Alerts: when latency > 500ms or error rate > 1%

---

### 3. API Rate Limiting Review (2 hours)

**Current:** 100 requests/min global; 10 try-ons/hour per user

**Consider:**
- Different limits for different endpoints
- Auth-aware limits (free vs premium)
- Stripe integration for usage tracking

---

## Checklist Summary

- [ ] Week 1: Fix 5 critical bugs + validation
  - [ ] NODE_ENV fix
  - [ ] Admin auth middleware
  - [ ] cart_items migration
  - [ ] Migration naming fix
  - [ ] JWT secret generation
  - [ ] Smoke tests pass

- [ ] Week 2: Logout + Checkout + Emails
  - [ ] Token blacklist implementation
  - [ ] Stripe checkout flow
  - [ ] Email verification
  - [ ] Password reset

- [ ] Week 3: Try-On UI + A/B Testing + Tests
  - [ ] Try-on React component
  - [ ] A/B testing framework + DB
  - [ ] 80% test coverage

- [ ] Week 4: Retraining + Monitoring
  - [ ] XGBoost retraining pipeline
  - [ ] Prometheus dashboards
  - [ ] Alert rules

---

## Resources

- **Stripe Docs:** https://stripe.com/docs/api
- **SendGrid Docs:** https://docs.sendgrid.com/
- **Jest Guide:** https://jestjs.io/docs/getting-started
- **Kubernetes CronJob:** https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
- **Prometheus TS Client:** https://github.com/siimon/prom-client

---

## Success Criteria

By end of 30 days:
- ✅ All 5 critical bugs fixed
- ✅ 95% uptime (monitoring proves it)
- ✅ Checkout flow working (can complete purchases)
- ✅ Email verified + password reset working
- ✅ Try-on UI launched
- ✅ A/B testing capability live
- ✅ 80% test coverage on core logic
- ✅ XGBoost retraining automated

**Result:** Production-ready system ready for real users 🚀

---

*Generated by Claude Code Senior Engineering Audit — March 17, 2026*
