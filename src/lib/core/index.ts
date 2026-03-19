/**
 * Core Infrastructure Exports
 * 
 * Database and search infrastructure.
 */
import "dotenv/config";

export {
  pg,
  testConnection,
  closePool,
  getProductsByIdsOrdered,
  productsTableHasIsHiddenColumn,
} from "./db";
export { osClient, ensureIndex, recreateIndex, getIndexStats } from "./opensearch";
export {
  CircuitBreaker,
  CircuitOpenError,
  getCircuit,
  withCircuitBreaker,
  getAllCircuitStats,
  isCircuitHealthy,
  CIRCUIT_CONFIGS,
} from "./circuitBreaker";
