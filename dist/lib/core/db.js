"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pg = void 0;
exports.testConnection = testConnection;
exports.closePool = closePool;
exports.getProductsByIdsOrdered = getProductsByIdsOrdered;
/**
 * Database Connection
 *
 * PostgreSQL connection pool using pg library.
 */
const pg_1 = require("pg");
const config_js_1 = require("../../config.js");
// export const pg = new Pool(config.postgres);
// // Handle pool errors
// pg.on("error", (err) => {
//   console.error("Unexpected database pool error:", err);
// });
//supabase
exports.pg = new pg_1.Pool({
    connectionString: config_js_1.config.database.url,
    ssl: {
        rejectUnauthorized: false,
    },
});
// Handle pool errors
exports.pg.on("error", (err) => {
    console.error("Unexpected database pool error:", err);
});
/**
 * Test database connection
 */
async function testConnection() {
    try {
        await exports.pg.query("SELECT 1");
        return true;
    }
    catch (error) {
        console.error("Database connection test failed:", error);
        return false;
    }
}
/**
 * Close database pool
 */
async function closePool() {
    await exports.pg.end();
}
/**
 * Get products by IDs preserving the order of IDs
 */
async function getProductsByIdsOrdered(ids) {
    if (ids.length === 0)
        return [];
    const numericIds = ids.map(id => typeof id === 'string' ? parseInt(id, 10) : id);
    const result = await exports.pg.query(`SELECT p.*, v.name as vendor_name
     FROM products p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.id = ANY($1::int[])`, [numericIds]);
    // Preserve order of input IDs
    const productMap = new Map(result.rows.map(p => [p.id, p]));
    return numericIds.map(id => productMap.get(id)).filter(Boolean);
}
