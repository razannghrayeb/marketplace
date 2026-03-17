# Documentation Index

Complete navigation guide for Fashion Aggregator API documentation (12 files, organized by topic).

---

## 🚀 Start Here

### Quick Navigation by Role

| Role | Start With | Duration |
|------|-----------|----------|
| **Executive/PM** | `../EXECUTIVE_SUMMARY.md` | 5 min |
| **Engineer** | `../README.md` | 10 min |
| **Tech Lead** | `../AUDIT_REPORT_MARCH_17_2026.md` | 20 min |
| **DevOps/Ops** | `../ACTION_PLAN_30_DAYS.md` | 30 min |
| **Feature Dev** | `SEARCH_API_COMPLETE.md` or `api-reference.md` | 5-15 min |

---

## 📖 Complete Documentation Map

### Core Reference (4 files)

| File | Purpose | Audience |
|------|---------|----------|
| **INDEX.md** | This file — navigation hub | Everyone |
| **IMPLEMENTATION_STATUS.md** | What's implemented, bugs, gaps | Tech leads |
| **architecture.md** | Module structure & patterns | Backend engineers |
| **api-reference.md** | Complete API specification | API consumers |

---

### Search & Discovery (3 files)

| File | Purpose | Audience |
|------|---------|----------|
| **SEARCH_API_COMPLETE.md** | All search features (user guide + technical) | Everyone |
| **multi-vector-search.md** | Multi-vector kNN deep-dive | ML engineers |
| **composite-query-system.md** | Advanced composite query details | Architecture |

---

### Machine Learning (2 files)

| File | Purpose | Audience |
|------|---------|----------|
| **ml-models.md** | Overview of all ML models (CLIP, YOLOv8, XGBoost, Gemini, Vertex AI) + Intent classification evaluation | ML engineers |
| **ml-intent-classification.md** | Intent classification system (rules + Random Forest ML) | NLP engineers |

---

### Operations (3 files)

| File | Purpose | Audience |
|------|---------|----------|
| **database.md** | Database schema, migrations, optimization | DBAs, Backend |
| **deployment.md** | Production deployment guide (Kubernetes, Docker) | DevOps, SRE |
| **ranker-runbook.md** | XGBoost ranker operational guide | ML Ops, SRE |

---

## 🎯 Task-Based Navigation

### "I want to understand..."

| Question | Read |
|----------|------|
| ...the whole system | `../README.md` → `SEARCH_API_COMPLETE.md` |
| ...all API endpoints | `api-reference.md` (full spec) or `SEARCH_API_COMPLETE.md` |
| ...search capabilities | `SEARCH_API_COMPLETE.md` (user guide + technical) |
| ...recommendations | `ml-models.md` → section on XGBoost Ranker |
| ...virtual try-on | `../EXECUTIVE_SUMMARY.md` → Feature #7 section |
| ...wardrobe | `../FEATURE_ANALYSIS.md` → Feature #6 section |
| ...code architecture | `architecture.md` |
| ...database | `database.md` |
| ...ML models | `ml-models.md` |
| ...what's broken/missing | `../IMPLEMENTATION_STATUS.md` |
| ...deployment | `deployment.md` |
| ...next 30 days plan | `../ACTION_PLAN_30_DAYS.md` |

---

### "I want to..."

| Task | Read |
|------|------|
| Implement a new search feature | `SEARCH_API_COMPLETE.md` (architecture) + `api-reference.md` |
| Add a new API endpoint | `architecture.md` (patterns) + `api-reference.md` (reference) |
| Fix a bug | `../IMPLEMENTATION_STATUS.md` (known bugs) |
| Deploy to production | `deployment.md` + `database.md` |
| Monitor models | `ranker-runbook.md` + `ml-models.md` |
| Train/retrain ML models | `ml-models.md` → Intent Classification Evaluation section |
| Understand wardrobe features | `../FEATURE_ANALYSIS.md` → Feature #6 |
| Use multi-image search API | `SEARCH_API_COMPLETE.md` (Part 1: User Guide) |
| Integrate with database | `database.md` → Schema section |
| Test search quality | `SEARCH_API_COMPLETE.md` (testing section) |
| Setup CI/CD | `../ACTION_PLAN_30_DAYS.md` → Week 4 |

---

## 📊 Documentation Stats

| Metric | Value |
|--------|-------|
| **Total files** | 17 (was 21 → 19% reduction) |
| **Total size** | ~180 KB |
| **Search-related** | 5 files (consolidated from 7) |
| **API reference** | 1 file |
| **ML/Models** | 3 files |
| **Operations** | 3 files |
| **Core reference** | 5 files (includes this index) |

---

## 🔄 Recent Changes (March 17, 2026 - Updated)

**Consolidation Completed:**
- ✅ Merged SEARCH_FEATURES_GUIDE + SEARCH_IMPLEMENTATION_SUMMARY → `SEARCH_API_COMPLETE.md`
- ✅ Merged model-evaluation-results metrics → `ml-models.md` (Intent Classification Evaluation section)
- ✅ Consolidated documentation from 17 → 12 files (-29% reduction)
- ✅ Removed redundant search guides (ENHANCED_SEARCH_GUIDE.md, COMPOSITE_QUERY_QUICKSTART.md)
- ✅ Removed duplicate image analysis content (content preserved in search API)
- ✅ Removed QUICK_REFERENCE.md (inaccurate endpoints; content in SEARCH_API_COMPLETE.md)

**Result:** 17 docs → 12 docs (-29%), focused and non-redundant documentation

---

## 📋 File Descriptions

### INDEX.md
This file. Master navigation hub for all documentation.

### IMPLEMENTATION_STATUS.md
**Latest:** March 17, 2026 (Full code audit)
Status of all 14 features, 5 critical bugs, and gaps. Authoritative source for "what's done/missing."

### architecture.md
Module structure, design patterns, guidelines for adding new routes/services.

### api-reference.md
Complete API specification for all endpoints with examples and parameters.

### SEARCH_API_COMPLETE.md
Consolidated comprehensive guide covering:
- Part 1: User Guide & Examples (Normal, YOLO, Multi-Image search)
- Part 2: Technical Deep-Dive (5-phase pipeline, performance, tuning)
Merges content from SEARCH_FEATURES_GUIDE + SEARCH_IMPLEMENTATION_SUMMARY.

### multi-vector-search.md
Specialized deep-dive on multi-vector kNN architecture and weighting strategies.

### composite-query-system.md
Technical documentation on composite query system, attribute extraction, reranking logic.

### ml-models.md
Overview of all ML models: CLIP, YOLOv8, XGBoost, Gemini, Vertex AI.
Includes Intent Classification model evaluation results and performance metrics.

### database.md
PostgreSQL schema, migrations, indexes, optimization strategies.

### deployment.md
Production deployment: Kubernetes YAML, Docker setup, environment variables.

### ranker-runbook.md
XGBoost ranker operations: training, serving, fallback behavior, health checks.

---

## 🔍 Cross-References

### Most-Linked Docs
1. `api-reference.md` ← referenced from everything
2. `SEARCH_API_COMPLETE.md` ← referenced from search-related docs
3. `architecture.md` ← referenced for code patterns
4. `../IMPLEMENTATION_STATUS.md` ← referenced for bugs/gaps

### Good Starting Points by Interest
- **Search enthusiasts** → `SEARCH_API_COMPLETE.md`
- **ML engineers** → `ml-models.md`
- **Ops/DevOps** → `deployment.md` + `ranker-runbook.md`
- **Full-stack devs** → `api-reference.md` + `database.md`

---

## 📝 Maintenance Notes

### When to Update Which Docs
- **API changes** → Update `api-reference.md` and `SEARCH_API_COMPLETE.md`
- **Bug fixes/features** → Update `../IMPLEMENTATION_STATUS.md`
- **Search improvements** → Update `SEARCH_API_COMPLETE.md`
- **ML model updates** → Update `ml-models.md`
- **Deployment changes** → Update `deployment.md`
- **Code patterns** → Update `architecture.md`

### Generation/Auto-Update Scripts
- `ENDPOINT_MATRIX.md` — Auto-generate via `pnpm docs:endpoints` (not in version control)

### Docs to Deprecate/Remove
- None currently (all 12 docs are active and non-redundant)

---

## 🎯 Success Criteria

Documentation is considered complete when:
- ✅ All API endpoints documented in `api-reference.md`
- ✅ All architecture patterns in `architecture.md`
- ✅ All bugs/gaps tracked in `../IMPLEMENTATION_STATUS.md`
- ✅ All ML models documented in `ml-models.md`
- ✅ Deployment guide updated for current infrastructure
- ✅ No broken links (checked quarterly)
- ✅ All docs dated (last updated shown)

---

**Last Updated:** March 17, 2026 (Consolidation Pass 2)
**Docs Status:** ✅ Clean, consolidated, non-redundant
**Total Files:** 12 (down from 21, -43% reduction)
