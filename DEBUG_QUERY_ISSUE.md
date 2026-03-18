# Query Processing Bug - BLAZER → OUTERWEAR

## Issue Summary
User searches for "blazer" → response shows semantic query as "outerwear"
- Original query: "blazer"
- Parsed query: "outerwear" 
- Results: 0 items returned

## Root Cause Analysis

### File: src/lib/search/semanticSearch.ts

**CATEGORY_MAP contains:**
```typescript
"outerwear": ["jacket", "jackets", "coat", "coats", "blazer", "blazers", "cardigan", ...],
```

**When user searches for "blazer":**
1. `extractEntities("blazer")` finds "blazer" in CATEGORY_MAP keywords
2. Adds `categories: ["outerwear"]` to entities
3. `buildSemanticQuery()` called with:
   - query = "blazer"
   - entities.categories = ["outerwear"]
4. buildSemanticQuery builds parts array:
   - Adds categories: `parts = ["outerwear"]`
   - Removes brands from query (none) - cleanedQuery still = "blazer"
   - **BUG**: The category keywords (like "blazer") should NOT be removed from the semantic query!

**Current behavior:**
- semanticQuery = "outerwear blazer" (should be fine)
- But OpenSearch query is applying category FILTER
- So it's searching for products matching "outerwear" category
- With title/description matching "outerwear" or "blazer"
- If product titles have "blazer" but category is NOT "outerwear", they won't match

### Secondary Issue

The **category filter is too strict**:
```typescript
if (effectiveCategory) filter.push({ term: { category: effectiveCategory } });
```

This means:
- Products must match: category = "outerwear" AND has "blazer" in title
- If a blazer product isn't tagged as "outerwear" in the database, it won't appear

## Solution

1. **Fix buildSemanticQuery** - Keep original query term even after category extraction
2. **Improve category handling** - Use extracted category for boosting, not strict filtering
3. **Better entity removal** - Remove category keywords from query to avoid duplication in semantic query
