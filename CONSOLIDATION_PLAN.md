# Root-Level Documentation Consolidation Plan

## Files to DELETE (Replaced by authoritative docs)

| File | Reason | Replacement |
|------|--------|-------------|
| **IMPLEMENTATION_SUMMARY.md** | Old search feature notes | `docs/ENHANCED_SEARCH_GUIDE.md` + `docs/IMPLEMENTATION_STATUS.md` |
| **AI_DOCS_README.md** | Old index (superseded) | `docs/INDEX.md` (new master index) |
| **AI_MODELS_OVERVIEW.md** | Old/stale ML overview | `docs/ml-models.md` (current) |
| **ARCHITECTURE_DIAGRAM.md** | Redirect stub (106 bytes) | `docs/architecture.md` (current) |
| **MODEL_HEALTH_CHECKLIST.md** | Redirect stub (134 bytes) | `docs/ml-models.md` → Model Health section |
| **MULTI_VECTOR_IMPLEMENTATION.md** | Old implementation notes | `docs/multi-vector-search.md` (current) |
| **ROUTES_INTEGRATION.md** | Old route reference | `docs/ENDPOINT_MATRIX.md` (auto-generated) |

**Total to delete:** 7 files, frees ~70KB

---

## Files to KEEP (Authoritative)

| File | Keep Reason | Status |
|------|-------------|--------|
| **README.md** | Main entry point | ✅ Updated Mar 17 |
| **FEATURE_ANALYSIS.md** | In-depth feature review | ✅ Updated Mar 17 |
| **ACTION_PLAN_30_DAYS.md** | Roadmap / tactical plan | ⚠️ Needs update |
| **EXECUTIVE_SUMMARY.md** | Executive overview | ⚠️ Needs review |
| **AUDIT_REPORT_MARCH_17_2026.md** | Senior audit | ✅ NEW - Current |

---

## Files to UPDATE

### 1. ACTION_PLAN_30_DAYS.md
**Issue:** References old/stale issues (XGBoost, CLIP, etc.) that are now implemented
**Update:** Rewrite to focus on actual missing features:
- Logout endpoint + token revocation
- Checkout/payment flow
- Email verification & password reset
- Try-on frontend UI
- A/B testing framework
- Automated model retraining

### 2. EXECUTIVE_SUMMARY.md
**Issue:** Likely outdated (references pre-Feature#6/7 state)
**Update:** Verify content against current state; update if needed

---

## Recommendation

**Action:**
1. DELETE: 7 old reference files (IMPLEMENTATION_SUMMARY, AI_DOCS_README, AI_MODELS_OVERVIEW, ARCHITECTURE_DIAGRAM, MODEL_HEALTH_CHECKLIST, MULTI_VECTOR_IMPLEMENTATION, ROUTES_INTEGRATION)
2. UPDATE: ACTION_PLAN_30_DAYS.md (rewrite with current priorities)
3. VERIFY: EXECUTIVE_SUMMARY.md (check if still accurate)
4. KEEP: README.md, FEATURE_ANALYSIS.md, AUDIT_REPORT, ACTION_PLAN (updated), EXECUTIVE_SUMMARY (verified)

**Result:** Cleaner root directory, single source of truth in `docs/INDEX.md`

