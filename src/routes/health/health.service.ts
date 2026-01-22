/**
 * Health Service
 * 
 * Business logic for health checks.
 */

import { osClient } from "../../lib/core/index.js";
import { pg } from "../../lib/core/index.js";

export interface HealthStatus {
  ok: boolean;
  search?: string;
  db?: string;
  error?: string;
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
