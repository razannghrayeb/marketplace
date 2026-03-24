/**
 * Health Service
 * 
 * Business logic for health checks.
 */

import { osClient } from "../../lib/core/index";
import { pg } from "../../lib/core/index";
import { getAllCircuitStats, type CircuitStats } from "../../lib/core/circuitBreaker";
import { getCacheStats, type CacheStats } from "../../lib/cache/embeddingCache";

export interface HealthStatus {
  ok: boolean;
  search?: string;
  db?: string;
  error?: string;
}

export interface DetailedHealthStatus extends HealthStatus {
  circuits?: Record<string, CircuitStats>;
  cache?: CacheStats;
}

/**
 * Check readiness - all dependencies available
 */
export async function checkReadiness(): Promise<HealthStatus> {
  try {
    // OpenSearch
    const os = await osClient.cluster.health();
    // Postgres
    await pg.query("SELECT 1");
    
    return { 
      ok: true, 
      search: os.body.status, 
      db: "ok" 
    };
  } catch (e) {
    return { 
      ok: false, 
      error: (e as Error).message 
    };
  }
}

/**
 * Check liveness - app is running
 */
export function checkLiveness(): HealthStatus {
  return { ok: true };
}

/**
 * Get detailed health status including circuit breakers and cache
 */
export async function getDetailedHealth(): Promise<DetailedHealthStatus> {
  const base = await checkReadiness();
  
  return {
    ...base,
    circuits: getAllCircuitStats(),
    cache: getCacheStats(),
  };
}
