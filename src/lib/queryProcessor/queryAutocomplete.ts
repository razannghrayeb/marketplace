/**
 * Query Autocomplete & Trending Queries Engine
 *
 * Provides intelligent query suggestions with:
 * - Prefix matching (traditional autocomplete)
 * - Trending queries (time-decayed popularity)
 * - Personalized suggestions (user history)
 * - Category-aware suggestions
 * - Popular queries (all-time favorites)
 *
 * Features:
 * - Real-time trending calculation (last 7 days, time-decayed)
 * - In-memory trie for fast prefix matching
 * - PostgreSQL for persistence
 * - Redis-ready for production scaling
 */

import { pg, queryWithPgCapacityRetry } from "../core";

// ─── Lazy startup (avoids competing with traffic on module import) ─────────

let autocompleteBootstrap: Promise<void> | null = null;
let periodicRefreshStarted = false;

/**
 * Run once: create tables if needed, prime caches, start periodic refresh.
 * Retries on Supabase session-pooler "max clients" errors.
 */
function ensureAutocompleteBootstrapped(): Promise<void> {
  if (!autocompleteBootstrap) {
    autocompleteBootstrap = (async () => {
      await queryWithPgCapacityRetry(
        "queryAutocompleteBootstrap",
        async () => {
          await initializeDatabase();
          await refreshCacheIfNeededInternal();
        },
        { attempts: 12, baseDelayMs: 800 },
      );
      console.log("[QueryAutocomplete] Initialized successfully");

      if (!periodicRefreshStarted) {
        periodicRefreshStarted = true;
        setInterval(() => {
          refreshCacheIfNeededInternal().catch((err) =>
            console.error("[QueryAutocomplete] Periodic refresh failed:", err),
          );
        }, CONFIG.cacheRefreshInterval);
      }
    })().catch((err) => {
      autocompleteBootstrap = null;
      throw err;
    });
  }
  return autocompleteBootstrap;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuerySuggestion {
  query: string;
  score: number;
  source: "trending" | "popular" | "history" | "category" | "completion";
  count?: number;
  lastSearched?: Date;
  category?: string;
}

export interface TrendingQuery {
  query: string;
  searchCount: number;
  trendScore: number;
  lastSearched: Date;
  category?: string;
}

export interface AutocompleteRequest {
  prefix: string;
  limit?: number;
  userId?: string;
  sessionId?: string;
  category?: string;
  includeTrending?: boolean;
  includePersonal?: boolean;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  maxSuggestions: 10,
  trendingWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
  trendingDecay: 0.95, // time decay factor per day
  minQueryLength: 2,
  minSearchCount: 3, // minimum searches to appear in suggestions
  cacheRefreshInterval: 5 * 60 * 1000, // 5 minutes
};

// ─── Trie Data Structure for Fast Prefix Matching ───────────────────────────

class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEndOfWord: boolean = false;
  query: string | null = null;
  count: number = 0;
  lastSearched: Date | null = null;
}

class Trie {
  root: TrieNode = new TrieNode();

  insert(query: string, count: number = 1, lastSearched: Date = new Date()): void {
    const normalized = query.toLowerCase().trim();
    let node = this.root;

    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;
    }

    node.isEndOfWord = true;
    node.query = query;
    node.count = count;
    node.lastSearched = lastSearched;
  }

  search(prefix: string, limit: number = 10): Array<{ query: string; count: number; lastSearched: Date }> {
    const normalized = prefix.toLowerCase().trim();
    let node = this.root;

    // Navigate to prefix node
    for (const char of normalized) {
      if (!node.children.has(char)) return [];
      node = node.children.get(char)!;
    }

    // DFS to collect all completions
    const results: Array<{ query: string; count: number; lastSearched: Date }> = [];
    this.dfs(node, results);

    // Sort by count descending
    results.sort((a, b) => b.count - a.count);

    return results.slice(0, limit);
  }

  private dfs(
    node: TrieNode,
    results: Array<{ query: string; count: number; lastSearched: Date }>
  ): void {
    if (node.isEndOfWord && node.query && node.lastSearched) {
      results.push({
        query: node.query,
        count: node.count,
        lastSearched: node.lastSearched,
      });
    }

    for (const child of node.children.values()) {
      this.dfs(child, results);
    }
  }
}

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

const queryTrie = new Trie();
let trendingCache: TrendingQuery[] = [];
let popularCache: QuerySuggestion[] = [];
let lastCacheRefresh: number = 0;

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get autocomplete suggestions for a query prefix
 */
export async function getAutocompleteSuggestions(
  request: AutocompleteRequest
): Promise<QuerySuggestion[]> {
  await ensureAutocompleteBootstrapped().catch(() => {
    /* suggestions still work from empty trie if DB unavailable */
  });

  const {
    prefix,
    limit = CONFIG.maxSuggestions,
    userId,
    category,
    includeTrending = true,
    includePersonal = true,
  } = request;

  if (prefix.length < CONFIG.minQueryLength) {
    // Return trending/popular for empty or very short prefix
    return includeTrending ? await getTrendingQueries(limit, category) : [];
  }

  // Ensure cache is fresh
  await refreshCacheIfNeeded();

  const suggestions: QuerySuggestion[] = [];

  // 1. Prefix completions from trie
  const completions = queryTrie.search(prefix, limit);
  for (const comp of completions) {
    suggestions.push({
      query: comp.query,
      score: comp.count,
      source: "completion",
      count: comp.count,
      lastSearched: comp.lastSearched,
    });
  }

  // 2. Trending queries matching prefix
  if (includeTrending) {
    const trending = trendingCache.filter(t =>
      t.query.toLowerCase().startsWith(prefix.toLowerCase())
    ).slice(0, 5);

    for (const trend of trending) {
      if (!suggestions.some(s => s.query === trend.query)) {
        suggestions.push({
          query: trend.query,
          score: trend.trendScore,
          source: "trending",
          count: trend.searchCount,
          lastSearched: trend.lastSearched,
          category: trend.category,
        });
      }
    }
  }

  // 3. Personal history (if userId provided)
  if (includePersonal && userId) {
    const personal = await getPersonalSuggestions(userId, prefix, 3);
    for (const p of personal) {
      if (!suggestions.some(s => s.query === p.query)) {
        suggestions.push(p);
      }
    }
  }

  // 4. Category-specific suggestions
  if (category) {
    const categorySuggestions = await getCategorySuggestions(prefix, category, 3);
    for (const cs of categorySuggestions) {
      if (!suggestions.some(s => s.query === cs.query)) {
        suggestions.push(cs);
      }
    }
  }

  // Sort by score and limit
  suggestions.sort((a, b) => b.score - a.score);

  return suggestions.slice(0, limit);
}

/**
 * Get trending queries (last 7 days, time-decayed)
 */
export async function getTrendingQueries(
  limit: number = 10,
  category?: string
): Promise<QuerySuggestion[]> {
  await ensureAutocompleteBootstrapped().catch(() => {});
  await refreshCacheIfNeeded();

  let trending = [...trendingCache];

  if (category) {
    trending = trending.filter(t => t.category === category);
  }

  return trending.slice(0, limit).map(t => ({
    query: t.query,
    score: t.trendScore,
    source: "trending" as const,
    count: t.searchCount,
    lastSearched: t.lastSearched,
    category: t.category,
  }));
}

/**
 * Get popular queries (all-time)
 */
export async function getPopularQueries(limit: number = 10): Promise<QuerySuggestion[]> {
  await ensureAutocompleteBootstrapped().catch(() => {});
  await refreshCacheIfNeeded();
  return popularCache.slice(0, limit);
}

/**
 * Log a search query for trending/autocomplete
 */
export async function logSearchQuery(
  query: string,
  userId?: string,
  category?: string,
  resultCount?: number
): Promise<void> {
  const normalized = query.toLowerCase().trim();

  if (normalized.length < CONFIG.minQueryLength) return;

  try {
    await ensureAutocompleteBootstrapped();
  } catch (err) {
    console.warn("[QueryAutocomplete] Skip query log — DB bootstrap failed:", err);
    return;
  }

  try {
    // Single connection + transaction: halves pool usage vs two separate pg.query calls
    // (important for Supabase session mode / tiny pool_size).
    await queryWithPgCapacityRetry(
      "logSearchQuery",
      async () => {
        const client = await pg.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `
            INSERT INTO search_queries (query, search_count, last_searched, user_id, category, result_count)
            VALUES ($1, 1, NOW(), $2, $3, $4)
            ON CONFLICT (query)
            DO UPDATE SET
              search_count = search_queries.search_count + 1,
              last_searched = NOW(),
              result_count = COALESCE($4, search_queries.result_count)
            `,
            [normalized, userId || null, category || null, resultCount ?? null],
          );
          if (userId) {
            await client.query(
              `
              INSERT INTO user_search_history (user_id, query, searched_at, category, result_count)
              VALUES ($1, $2, NOW(), $3, $4)
              `,
              [userId, normalized, category || null, resultCount ?? null],
            );
          }
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
      { attempts: 8, baseDelayMs: 500 },
    );

    queryTrie.insert(normalized, 1, new Date());
  } catch (err) {
    console.error("[QueryAutocomplete] Failed to log query:", err);
  }
}

// ─── Cache Management ────────────────────────────────────────────────────────

async function refreshCacheIfNeeded(): Promise<void> {
  await ensureAutocompleteBootstrapped().catch(() => {});
  await refreshCacheIfNeededInternal();
}

async function refreshCacheIfNeededInternal(): Promise<void> {
  const now = Date.now();

  if (now - lastCacheRefresh < CONFIG.cacheRefreshInterval) {
    return; // Cache still fresh
  }

  try {
    await queryWithPgCapacityRetry(
      "autocompleteCacheRefresh",
      async () => {
        trendingCache = await computeTrendingQueries();
        popularCache = await computePopularQueries();
        await rebuildTrie();
        lastCacheRefresh = Date.now();
      },
      { attempts: 8, baseDelayMs: 600 },
    );
  } catch (err) {
    console.error("[QueryAutocomplete] Cache refresh failed:", err);
  }
}

async function computeTrendingQueries(): Promise<TrendingQuery[]> {
  const windowStart = new Date(Date.now() - CONFIG.trendingWindow);

  const result = await pg.query(
    `
    SELECT
      query,
      SUM(daily_count) as search_count,
      MAX(search_date) as last_searched,
      category
    FROM (
      SELECT
        query,
        DATE(last_searched) as search_date,
        COUNT(*) as daily_count,
        category
      FROM search_queries
      WHERE last_searched >= $1
      GROUP BY query, search_date, category
    ) daily
    GROUP BY query, category
    HAVING SUM(daily_count) >= $2
    ORDER BY search_count DESC
    LIMIT 100
    `,
    [windowStart, CONFIG.minSearchCount]
  );

  const now = Date.now();

  // Apply time decay
  return result.rows.map((row: any) => {
    const daysSinceSearch = (now - new Date(row.last_searched).getTime()) / (24 * 60 * 60 * 1000);
    const decay = Math.pow(CONFIG.trendingDecay, daysSinceSearch);
    const trendScore = row.search_count * decay;

    return {
      query: row.query,
      searchCount: parseInt(row.search_count, 10),
      trendScore,
      lastSearched: new Date(row.last_searched),
      category: row.category,
    };
  }).sort((a, b) => b.trendScore - a.trendScore);
}

async function computePopularQueries(): Promise<QuerySuggestion[]> {
  const result = await pg.query(
    `
    SELECT query, search_count, last_searched
    FROM search_queries
    WHERE search_count >= $1
    ORDER BY search_count DESC
    LIMIT 50
    `,
    [CONFIG.minSearchCount]
  );

  return result.rows.map((row: any) => ({
    query: row.query,
    score: row.search_count,
    source: "popular" as const,
    count: row.search_count,
    lastSearched: new Date(row.last_searched),
  }));
}

async function rebuildTrie(): Promise<void> {
  const result = await pg.query(
    `
    SELECT query, search_count, last_searched
    FROM search_queries
    WHERE search_count >= $1
    ORDER BY search_count DESC
    LIMIT 10000
    `,
    [CONFIG.minSearchCount]
  );

  // Clear and rebuild
  const newTrie = new Trie();
  for (const row of result.rows) {
    newTrie.insert(row.query, row.search_count, new Date(row.last_searched));
  }

  // Replace global trie
  Object.assign(queryTrie, newTrie);
}

// ─── Personal & Category Suggestions ─────────────────────────────────────────

async function getPersonalSuggestions(
  userId: string,
  prefix: string,
  limit: number
): Promise<QuerySuggestion[]> {
  const result = await pg.query(
    `
    SELECT query, COUNT(*) as count, MAX(searched_at) as last_searched
    FROM user_search_history
    WHERE user_id = $1 AND query LIKE $2
    GROUP BY query
    ORDER BY count DESC, last_searched DESC
    LIMIT $3
    `,
    [userId, `${prefix}%`, limit]
  );

  return result.rows.map((row: any) => ({
    query: row.query,
    score: row.count * 1.5, // Boost personal queries
    source: "history" as const,
    count: parseInt(row.count, 10),
    lastSearched: new Date(row.last_searched),
  }));
}

async function getCategorySuggestions(
  prefix: string,
  category: string,
  limit: number
): Promise<QuerySuggestion[]> {
  const result = await pg.query(
    `
    SELECT query, search_count, last_searched
    FROM search_queries
    WHERE category = $1 AND query LIKE $2
    ORDER BY search_count DESC
    LIMIT $3
    `,
    [category, `${prefix}%`, limit]
  );

  return result.rows.map((row: any) => ({
    query: row.query,
    score: row.search_count * 1.2, // Boost category-specific
    source: "category" as const,
    count: row.search_count,
    lastSearched: new Date(row.last_searched),
    category,
  }));
}

// ─── Database Schema (run once) ──────────────────────────────────────────────

export async function initializeDatabase(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS search_queries (
      query VARCHAR(500) PRIMARY KEY,
      search_count INTEGER NOT NULL DEFAULT 1,
      last_searched TIMESTAMP NOT NULL DEFAULT NOW(),
      user_id VARCHAR(100),
      category VARCHAR(100),
      result_count INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_search_queries_last_searched
      ON search_queries(last_searched DESC);

    CREATE INDEX IF NOT EXISTS idx_search_queries_search_count
      ON search_queries(search_count DESC);

    CREATE INDEX IF NOT EXISTS idx_search_queries_category
      ON search_queries(category);

    CREATE TABLE IF NOT EXISTS user_search_history (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL,
      query VARCHAR(500) NOT NULL,
      searched_at TIMESTAMP NOT NULL DEFAULT NOW(),
      category VARCHAR(100),
      result_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_user_search_history_user_id
      ON user_search_history(user_id, searched_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_search_history_query
      ON user_search_history(query);
  `);

  console.log("[QueryAutocomplete] Database initialized");
}

// ─── Startup ─────────────────────────────────────────────────────────────────
// DB work is deferred to first autocomplete / search-log request via
// ensureAutocompleteBootstrapped() so cold starts do not spike connections
// against Supabase session pooler alongside other routes.
