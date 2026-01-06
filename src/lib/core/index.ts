/**
 * Core Infrastructure Exports
 * 
 * Database and search infrastructure.
 */

export { pg, testConnection, closePool, getProductsByIdsOrdered } from "./db";
export { osClient, ensureIndex, recreateIndex, getIndexStats } from "./opensearch";
