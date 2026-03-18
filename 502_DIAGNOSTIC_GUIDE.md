# 🔍 502 Bad Gateway - Diagnostic Checklist

## What 502 Means
✅ **Request reached Render** → ✅ **Render forwarded to app** → **❌ App/backend failed** → **502 returned**

---

## Original Issue: `/search/trending` returns 502

### Root Cause Map

| Component | Likelihood | Check |
|-----------|---|---|
| Database (PostgreSQL) | 🔴 HIGH | Is `DATABASE_URL` set correctly? Can it query `search_queries` table? |
| Cache initialization | 🔴 HIGH | Does `queryAutocomplete.ts` initialize without errors? |
| Silent initialization failure | 🔴 HIGH | Are errors caught but not logged as fatal? |
| OpenSearch connection | 🟡 MEDIUM | Is `OS_NODE` reachable? |
| Service timeout | 🟡 MEDIUM | Is the request hitting Render's timeout (~120s)? |
| Memory | 🟡 MEDIUM | Is the Starter plan underpowered? |

---

## Quick Diagnostics

### 1️⃣ Check Service Health
```bash
# Is the app running?
curl https://marketplace-main.onrender.com/health/live

# Expected: { "ok": true }
# If 502 here: App crashed on startup
```

### 2️⃣ Check Dependencies
```bash
# Are all services ready?
curl https://marketplace-main.onrender.com/health/ready

# Expected: { "ok": true, "search": "green", "db": "ok" }
# If this fails: OpenSearch or DB is down
```

### 3️⃣ Check Database Connection
In Render logs, look for:
```
[QueryAutocomplete] Database initialized
[QueryAutocomplete] Initialized successfully
```

If you see:
```
[QueryAutocomplete] FATAL: Initialization failed
```
→ **Database connection in queryAutocomplete failed**

### 4️⃣ Check if search_queries Table Exists
```bash
# SSH into Render and run:
psql $DATABASE_URL -c "SELECT COUNT(*) FROM search_queries;"

# If: relation "search_queries" does not exist
# → Table wasn't created by queryAutocomplete.ts
```

---

## Specific to Your Endpoints

### Issue 1: `/search/trending` - 502

**Expected Flow:**
1. ✅ Render receives GET /search/trending
2. ✅ Routes to ML service (via proxy in marketplace-api)
3. ✅ ML service's queryAutocomplete initializes DB
4. ✅ Queries search_queries table
5. ✅ Returns trending queries

**Failure Points:**
- [ ] Step 3: Database not initialized (silent failure in async IIFE)
- [ ] Step 4: `search_queries` table doesn't exist
- [ ] Step 4: Database connection times out (slow network)
- [ ] Step 5: Query takes >120s (Render timeout)

**Our Fix:** Added error handling to fail fast if DB init fails

```typescript
// BEFORE (Silent failure)
(async () => {
  try {
    await initializeDatabase(); // Could fail silently
    await refreshCacheIfNeeded();
  } catch (err) {
    console.error("[QueryAutocomplete] Initialization failed:", err);
    // ❌ Continues anyway!
  }
})();

// AFTER (Fails fast)
(async () => {
  try {
    await initializeDatabase();
    await refreshCacheIfNeeded();
  } catch (err) {
    console.error("[QueryAutocomplete] FATAL: Initialization failed:", err);
    throw err; // ✅ Stops the service startup
  }
})();
```

### Issue 2: `/products/search?q=blazer` - 0 Results

**Our Fix:** Preserved original query term in semantic search
- ✅ This doesn't cause 502 (returns 200 with empty data)
- ✅ But improves search UX significantly

---

## Instructions for Your Teammate

### Quick Troubleshooting (5 min)

1. Check Render dashboard logs:
   ```
   Render Cloud → marketplace-main → Logs → Filter for "ERROR" or "FATAL"
   ```

2. Look for line:
   ```
   [QueryAutocomplete] FATAL: Initialization failed
   ```
   If present → Database issue

3. Check environment variables synced:
   ```
   Render Cloud → Settings → Environment
   - DATABASE_URL should be synced
   - OS_NODE should be synced
   ```

4. Test health endpoint:
   ```bash
   curl https://marketplace-main.onrender.com/health/live
   ```
   - Returns `{"ok":true}` → App is up
   - Returns 502 → App crashed

### Deeper Troubleshooting (15 min)

1. **Test database connectivity**
   ```bash
   # In Render dashboard, go to marketplace-ml service
   # Click "Connect" to get SSH command
   # Then:
   psql $DATABASE_URL -c "SELECT 1;"
   
   # Should return: 1
   # If connection refused → DB is unreachable
   ```

2. **Check table existence**
   ```bash
   psql $DATABASE_URL -c "\dt" | grep search_queries
   
   # Should show search_queries
   # If nothing → Table wasn't created
   ```

3. **Check recent logs for errors**
   ```bash
   # In Render logs, look for:
   - Cannot find module
   - Connection timeout
   - ECONNREFUSED
   - Out of memory
   ```

4. **Monitor query performance**
   ```bash
   # After fix is deployed, test:
   curl "https://marketplace-main.onrender.com/search/trending?limit=10"
   
   # Check response time (should be <500ms)
   # If >20s → DB query is slow
   ```

---

## For Your Search Query Fix

### Validation Checklist
- [x] TypeScript compiles ✅
- [x] Tests pass (4/4) ✅
- [x] No breaking changes ✅
- [x] Build successful ✅
- [x] Pushed to branch `razan` ✅

### Deployment Readiness
```bash
# When ready to deploy:
git checkout main
git merge razan
git push origin main

# Render will auto-deploy (if autoDeploy enabled)
# Monitor: https://marketplace-main.onrender.com/health/live
```

### Validation After Deployment
```bash
# Test the fixed query
curl "https://marketplace-main.onrender.com/products/search?q=blazer&limit=24&page=1"

# Expected changes:
# - "data" array has items (was empty before)
# - "meta.query" is "blazer" (was "outerwear" before)
# - Response time <500ms
```

---

## Environment Variables to Verify

### For ML Service (marketplace-ml)
```
DATABASE_URL          ← Used by queryAutocomplete
OS_NODE              ← OpenSearch cluster
OS_USERNAME          ← OpenSearch auth
OS_PASSWORD          ← OpenSearch auth
CLIP_MODEL_PATH      ← For image search
```

### For API Service (marketplace-api)  
```
ML_SERVICE_URL       ← Should be https://marketplace-ml.onrender.com
DATABASE_URL         ← Backup if ML service is down
```

---

## Common 502 Scenarios

| Scenario | Symptom | Fix |
|----------|---------|-----|
| DB down | Health check fails | Contact DB provider |
| DB not synced to Render | Search queries fail | Sync env vars in Render UI |
| CLIP model not loaded | Image search fails | Check logs for model load error |
| Timeout on first request | 502 for trending (first call) | Cache warming on startup |
| Out of memory | Random 502s | Upgrade Render plan |
| Network latency | 502 after 20-25s | Check region, optimize queries |

---

## Monitoring Going Forward

### Set Alerts For:
- [ ] `POST /products/search/image` response time > 10s
- [ ] `/search/trending` response time > 5s  
- [ ] Database query time > 3s
- [ ] Error rate > 1% for search endpoints
- [ ] 502 responses anywhere

### Add Logging For:
```typescript
// queryAutocomplete.ts startup
console.timeEnd("[QueryAutocomplete]");

// Each trending request
console.log(`[Trending] Fetched ${trending.length} queries in ${elapsed}ms`);

// Search error
console.error(`[Search] Query "${q}" took ${elapsed}ms`, error);
```

---

## Testing Post-Deployment

```bash
#!/bin/bash
# Test suite for search endpoints

echo "🧪 Testing Search Endpoints"

# 1. Health check
echo "1️⃣ Health check..."
curl -s https://marketplace-main.onrender.com/health/live | jq .

# 2. Trending endpoint
echo "2️⃣ Trending queries..."
curl -s "https://marketplace-main.onrender.com/search/trending?limit=5" | jq '.trending[]?.query'

# 3. Search with fixed query
echo "3️⃣ Search for blazer..."
RESULT=$(curl -s "https://marketplace-main.onrender.com/products/search?q=blazer&limit=5")
echo $RESULT | jq '.data | length'

# 4. Check semantic query in response
echo "4️⃣ Semantic query includes original..."
echo $RESULT | jq '.meta.semantic_query' | grep -i blazer && echo "✅ PASS" || echo "❌ FAIL"
```

---

## Next Steps

1. ✅ **Verify fix compiles** - DONE (pnpm build successful)
2. ✅ **Run tests** - DONE (4/4 passing)
3. ⏳ **Merge to main** - Ready (push to main branch)
4. ⏳ **Deploy** - Render will auto-deploy
5. ⏳ **Monitor** - Watch health endpoint and error logs
6. ⏳ **Verify** - Test trending and search endpoints
7. ⏳ **Alert team** - Share success metrics

---

**Status:** Ready for production deployment ✅  
**Risk Level:** Low (fixes don't break existing functionality)  
**Rollback Time:** <5 minutes
