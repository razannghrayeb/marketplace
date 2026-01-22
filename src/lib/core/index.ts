/**
 * Core Infrastructure Exports
 * 
 * Database and search infrastructure.
 */
import "dotenv/config";

export { pg, testConnection, closePool, getProductsByIdsOrdered } from "./db.js";
export { osClient, ensureIndex, recreateIndex, getIndexStats } from "./opensearch.js";
