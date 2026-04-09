# Documentation Index

Complete navigation guide for Fashion Aggregator API documentation (organized by topic).

---

## 🚀 Start Here

### Quick Navigation by Role

| Role | Start With | Duration |
|------|-----------|----------|
| **Executive/PM** | `../EXECUTIVE_SUMMARY.md` or **`FEATURES.md`** | 5–10 min |
| **Engineer** | `../README.md` | 10 min |
| **Tech Lead** | `../AUDIT_REPORT_MARCH_17_2026.md` | 20 min |
| **DevOps/Ops** | `../ACTION_PLAN_30_DAYS.md` | 30 min |
| **Feature Dev** | `embeddings-and-search-pipelines.md` or `SEARCH_API_COMPLETE.md` or `api-reference.md` | 10-20 min |

---

## 📖 Complete Documentation Map

### Core Reference (5 files)

| File | Purpose | Audience |
|------|---------|----------|
| **INDEX.md** | This file — navigation hub | Everyone |
| **FEATURES.md** | **Product features → endpoints & integration checklist** | PM, frontend, full-stack |
| **IMPLEMENTATION_STATUS.md** | What's implemented, bugs, gaps | Tech leads |
| **architecture.md** | Module structure & patterns | Backend engineers |
| **api-reference.md** | Complete API specification | API consumers |
| **compare-intelligent-shopping.md** | Intelligent compare goals, modes, and response contract | Product, backend, frontend |

---

### Search & Discovery (5 files)

| File | Purpose | Audience |
|------|---------|----------|
| **embeddings-and-search-pipelines.md** | **Embeddings, OpenSearch fields, ingest vs query paths (text + image)** | Backend, ML, search engineers |
| **SEARCH_API_COMPLETE.md** | All search features (user guide + technical) | Everyone |
| **multi-image-attribute-transfer.md** | Multi-image attribute transfer feature architecture and build details | Backend, search engineers, integrators |
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
| ...the whole system | `../README.md` → **`FEATURES.md`** → `SEARCH_API_COMPLETE.md` |
| ...all API endpoints | `api-reference.md` (full spec) or `SEARCH_API_COMPLETE.md` |
| ...intelligent fashion compare | `compare-intelligent-shopping.md` |
| ...search capabilities | `SEARCH_API_COMPLETE.md` (user guide + technical) |
| ...embeddings & how search uses vectors | **`embeddings-and-search-pipelines.md`** |
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
| Implement a new search feature | **`embeddings-and-search-pipelines.md`** + `SEARCH_API_COMPLETE.md` + `api-reference.md` |
| Add a new API endpoint | `architecture.md` (patterns) + `api-reference.md` (reference) |
| Implement/adjust compare behavior | `compare-intelligent-shopping.md` + `api-reference.md` |
| Fix a bug | `../IMPLEMENTATION_STATUS.md` (known bugs) |
| Deploy to production | `deployment.md` + `database.md` |
| Monitor models | `ranker-runbook.md` + `ml-models.md` |
| Train/retrain ML models | `ml-models.md` → Intent Classification Evaluation section |
| Understand wardrobe features | `../FEATURE_ANALYSIS.md` → Feature #6 |
| Use multi-image search API | `SEARCH_API_COMPLETE.md` (Part 1: User Guide) |
| Understand how multi-image transfer is built | `multi-image-attribute-transfer.md` |
| Integrate with database | `database.md` → Schema section |
| Test search quality | `SEARCH_API_COMPLETE.md` (testing section) |
| Setup CI/CD | `../ACTION_PLAN_30_DAYS.md` → Week 4 |

---

## 📊 Documentation Stats

| Metric | Value |
|--------|-------|
| **Total files** | 13+ in `docs/` (see table above) |
| **Search-related** | Includes **`embeddings-and-search-pipelines.md`** + text / multi-vector / composite |
| **API reference** | 1 file |
| **ML/Models** | 3 files |
| **Operations** | 3 files |
| **Core reference** | 5 files (includes this index) |

---

## 🔄 Recent Changes

**April 2026:** Image-ranking hardening in **`embeddings-and-search-pipelines.md`**: unified `v1`/`v2` score normalization, calibrated dual-kNN blend, stage-8 relevance, BLIP consistency/alignment tuning, intent-aware rescue; optional **`BLIP_API_URL`** in **`deploy-cloud-run.md`**.

**March 2026:** Added **`embeddings-and-search-pipelines.md`** and **`FEATURES.md`** — vector field map, ingest/query pipelines, feature ↔ endpoint map.
**Earlier consolidation:** legacy standalone search guides were merged into `SEARCH_API_COMPLETE.md`. **Current docs hub:** `FEATURES.md`, `embeddings-and-search-pipelines.md`, `IMPLEMENTATION_STATUS.md`.

---

## 📋 File Descriptions

### INDEX.md
This file. Master navigation hub for all documentation.

### FEATURES.md
User- and integrator-oriented map of **Discover, search, complete style, wardrobe, try-on**, etc., with **correct path prefixes** (`/search` vs `/products` vs `/api/...`) and links to deeper docs.

### IMPLEMENTATION_STATUS.md
**Latest:** April 2026 (periodic doc sync; verify routes in `src/server.ts`)
Status of all 14 features, 5 critical bugs, and gaps. Authoritative source for "what's done/missing."

### architecture.md
Module structure, design patterns, guidelines for adding new routes/services.

### api-reference.md
Complete API specification for all endpoints with examples and parameters.

### SEARCH_API_COMPLETE.md
Consolidated comprehensive guide covering:
- Part 1: User Guide & Examples (Normal, YOLO, Multi-Image search)
- Part 2: Technical Deep-Dive (5-phase pipeline, performance, tuning)
Consolidated from older search guides; use **`FEATURES.md`** for endpoint paths.

### multi-vector-search.md
Specialized deep-dive on multi-vector kNN architecture and weighting strategies.

### composite-query-system.md
Technical documentation on composite query system, attribute extraction, reranking logic.

### embeddings-and-search-pipelines.md
How **CLIP (and related) embeddings** land in **OpenSearch**, and how **image** vs **text** search **pipelines** call kNN, BM25, reranking, and supporting services.

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
- **Search enthusiasts** → **`embeddings-and-search-pipelines.md`** → `SEARCH_API_COMPLETE.md`
- **ML engineers** → `ml-models.md`
- **Ops/DevOps** → `deployment.md` + `ranker-runbook.md`
- **Full-stack devs** → `api-reference.md` + `database.md`

---

## 📝 Maintenance Notes

### When to Update Which Docs
- **API changes** → Update `api-reference.md`, `SEARCH_API_COMPLETE.md`, and **`FEATURES.md`** when user-facing behavior or paths change
- **Bug fixes/features** → Update `../IMPLEMENTATION_STATUS.md`
- **Search improvements** → Update `SEARCH_API_COMPLETE.md` and **`embeddings-and-search-pipelines.md`** (if vectors / pipelines change)
- **ML model updates** → Update `ml-models.md`
- **Deployment changes** → Update `deployment.md`
- **Code patterns** → Update `architecture.md`

### Generation/Auto-Update Scripts
- `ENDPOINT_MATRIX.md` — Auto-generate via `pnpm docs:endpoints` (not in version control)

### Docs to Deprecate/Remove
- Audit quarterly; **`embeddings-and-search-pipelines.md`** should stay aligned with `opensearch.ts` and `fashionSearchFacade.ts`

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

**Last Updated:** April 2026
**Docs Status:** Search pipeline architecture + ranking hardening documented in **`embeddings-and-search-pipelines.md`**; **`FEATURES.md`** for endpoints.
