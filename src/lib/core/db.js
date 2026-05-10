"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pg = void 0;
exports.isPgCapacityError = isPgCapacityError;
exports.queryWithPgCapacityRetry = queryWithPgCapacityRetry;
exports.productsTableHasIsHiddenColumn = productsTableHasIsHiddenColumn;
exports.productsTableHasCanonicalIdColumn = productsTableHasCanonicalIdColumn;
exports.productsTableHasGenderColumn = productsTableHasGenderColumn;
exports.toPgVectorParam = toPgVectorParam;
exports.testConnection = testConnection;
exports.closePool = closePool;
exports.getProductsByIdsOrdered = getProductsByIdsOrdered;
exports.getSearchProductsByIdsOrdered = getSearchProductsByIdsOrdered;
/**
 * Database Connection
 *
 * PostgreSQL connection pool using pg library.
 */
var pg_1 = require("pg");
var dns_1 = require("dns");
var config_1 = require("../../config");
// Force IPv4-first DNS resolution — avoids long IPv6 timeouts on Windows
// when connecting to cloud-hosted databases (Supabase, Neon, etc.)
(dns_1.default || dns_1).setDefaultResultOrder("ipv4first");
/**
 * Session-mode poolers (PgBouncer, Supabase pooler on :5432) cap clients at pool_size.
 * Node's pg default max=10 × many instances → MaxClientsInSessionMode.
 * Override anytime with PG_POOL_MAX (e.g. 1 for Supabase session mode).
 */
function resolvePoolMax() {
    var _a;
    var raw = (_a = process.env.PG_POOL_MAX) === null || _a === void 0 ? void 0 : _a.trim();
    if (raw !== undefined && raw !== "") {
        var n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }
    var dbUrl = process.env.DATABASE_URL || "";
    // Supabase transaction pooler (6543) can handle more; session pooler (5432) cannot.
    var isSupabaseSessionPooler = /pooler\.supabase\.com/i.test(dbUrl) &&
        !/:6543\b/.test(dbUrl) &&
        !/transaction/i.test(dbUrl);
    if (isSupabaseSessionPooler || /pgbouncer=true/i.test(dbUrl)) {
        return 1;
    }
    if (process.env.K_SERVICE) {
        return 1;
    }
    if (process.env.NODE_ENV === "production") {
        return 10;
    }
    return 10;
}
/** True for PgBouncer / Supabase session pool "max clients" style errors */
function isPgCapacityError(err) {
    var msg = String((err === null || err === void 0 ? void 0 : err.message) || "").toLowerCase();
    return (msg.includes("maxclientsinsessionmode") ||
        msg.includes("max clients reached") ||
        msg.includes("too many connections"));
}
/**
 * Retry a DB operation when the pooler rejects new sessions (transient under load).
 */
function queryWithPgCapacityRetry(label, fn, opts) {
    return __awaiter(this, void 0, void 0, function () {
        var attempts, baseDelayMs, lastErr, _loop_1, i, state_1;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    attempts = (_a = opts === null || opts === void 0 ? void 0 : opts.attempts) !== null && _a !== void 0 ? _a : 8;
                    baseDelayMs = (_b = opts === null || opts === void 0 ? void 0 : opts.baseDelayMs) !== null && _b !== void 0 ? _b : 400;
                    _loop_1 = function (i) {
                        var _d, err_1, delay_1;
                        return __generator(this, function (_e) {
                            switch (_e.label) {
                                case 0:
                                    _e.trys.push([0, 2, , 4]);
                                    _d = {};
                                    return [4 /*yield*/, fn()];
                                case 1: return [2 /*return*/, (_d.value = _e.sent(), _d)];
                                case 2:
                                    err_1 = _e.sent();
                                    lastErr = err_1;
                                    if (!isPgCapacityError(err_1) || i === attempts) {
                                        throw err_1;
                                    }
                                    delay_1 = Math.min(30000, baseDelayMs * i);
                                    console.warn("[pg] ".concat(label, ": pooler capacity (").concat(i, "/").concat(attempts, ") \u2014 retry in ").concat(delay_1, "ms"));
                                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, delay_1); })];
                                case 3:
                                    _e.sent();
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    };
                    i = 1;
                    _c.label = 1;
                case 1:
                    if (!(i <= attempts)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(i)];
                case 2:
                    state_1 = _c.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _c.label = 3;
                case 3:
                    i++;
                    return [3 /*break*/, 1];
                case 4: throw lastErr;
            }
        });
    });
}
exports.pg = new pg_1.Pool({
    connectionString: config_1.config.database.url,
    max: resolvePoolMax(),
    ssl: {
        rejectUnauthorized: false,
    },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});
var cachedProductsHasIsHidden;
var cachedProductsHasCanonicalId;
var cachedProductsHasGender;
/** Cached once per process; avoids 42703 when prod DB is behind migrations. */
function productsTableHasIsHiddenColumn() {
    return __awaiter(this, void 0, void 0, function () {
        var r;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (cachedProductsHasIsHidden !== undefined) {
                        return [2 /*return*/, cachedProductsHasIsHidden];
                    }
                    return [4 /*yield*/, exports.pg.query("SELECT 1\n     FROM information_schema.columns\n     WHERE table_schema = 'public'\n       AND table_name = 'products'\n       AND column_name = 'is_hidden'\n     LIMIT 1")];
                case 1:
                    r = _b.sent();
                    cachedProductsHasIsHidden = ((_a = r.rowCount) !== null && _a !== void 0 ? _a : 0) > 0;
                    return [2 /*return*/, cachedProductsHasIsHidden];
            }
        });
    });
}
/** Cached once per process. */
function productsTableHasCanonicalIdColumn() {
    return __awaiter(this, void 0, void 0, function () {
        var r;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (cachedProductsHasCanonicalId !== undefined) {
                        return [2 /*return*/, cachedProductsHasCanonicalId];
                    }
                    return [4 /*yield*/, exports.pg.query("SELECT 1\n     FROM information_schema.columns\n     WHERE table_schema = 'public'\n       AND table_name = 'products'\n       AND column_name = 'canonical_id'\n     LIMIT 1")];
                case 1:
                    r = _b.sent();
                    cachedProductsHasCanonicalId = ((_a = r.rowCount) !== null && _a !== void 0 ? _a : 0) > 0;
                    return [2 /*return*/, cachedProductsHasCanonicalId];
            }
        });
    });
}
/** Cached once per process; `gender` added in migration 013_products_gender.sql. */
function productsTableHasGenderColumn() {
    return __awaiter(this, void 0, void 0, function () {
        var r;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (cachedProductsHasGender !== undefined) {
                        return [2 /*return*/, cachedProductsHasGender];
                    }
                    return [4 /*yield*/, exports.pg.query("SELECT 1\n     FROM information_schema.columns\n     WHERE table_schema = 'public'\n       AND table_name = 'products'\n       AND column_name = 'gender'\n     LIMIT 1")];
                case 1:
                    r = _b.sent();
                    cachedProductsHasGender = ((_a = r.rowCount) !== null && _a !== void 0 ? _a : 0) > 0;
                    return [2 /*return*/, cachedProductsHasGender];
            }
        });
    });
}
// Handle pool errors
exports.pg.on("error", function (err) {
    console.error("Unexpected database pool error:", err);
});
/**
 * Serialize a float embedding for pgvector `vector` columns.
 * node-pg binds JS arrays as PostgreSQL float8[]; its text form is not valid for the `vector` type.
 * Use the returned value as a query parameter and cast the placeholder, e.g. `$1::vector`.
 */
function toPgVectorParam(embedding) {
    if (embedding == null || embedding.length === 0)
        return null;
    return "[".concat(embedding.join(","), "]");
}
/** Short hints for common Supabase/pg auth failures (no secrets logged). */
function databaseConnectionHints(err) {
    var _a, _b, _c, _d;
    var e = err;
    var code = (_a = e === null || e === void 0 ? void 0 : e.code) !== null && _a !== void 0 ? _a : "";
    var msg = String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : "").toLowerCase();
    var url = (_d = (_c = process.env.DATABASE_URL) === null || _c === void 0 ? void 0 : _c.trim()) !== null && _d !== void 0 ? _d : "";
    var hints = [];
    if (!url) {
        hints.push("DATABASE_URL is missing or empty — set it in .env (Supabase: Settings → Database → connection string).");
        return hints;
    }
    if (code === "ECONNREFUSED" ||
        msg.includes("econnrefused") ||
        msg.includes("connect econnrefused")) {
        hints.push("Nothing accepted the connection at the host:port in DATABASE_URL — Postgres not running locally, wrong port, or firewall/VPN.");
        hints.push("If the host is 127.0.0.1:5432, start local Postgres or switch DATABASE_URL to your Supabase pooler URI.");
    }
    if (code === "08006" || msg.includes("authentication") || msg.includes("password")) {
        hints.push("Check password: copy the database password from Supabase (not the anon/service API keys).");
        hints.push("If the password has @ # % + etc., URL-encode it inside DATABASE_URL.");
        hints.push("Pooler: use the exact user from the dashboard (often postgres.<project-ref> on pooler hosts). Wrong user causes auth failures.");
        hints.push("Try transaction pooler port 6543 vs direct 5432 if one fails; set PG_POOL_MAX=1 for session pooler (:5432 pooler).");
    }
    if (code === "ENOTFOUND" || msg.includes("getaddrinfo")) {
        hints.push("DNS/host typo in DATABASE_URL, or offline VPN/firewall blocking the DB host.");
    }
    return hints;
}
/**
 * Test database connection
 */
function testConnection() {
    return __awaiter(this, void 0, void 0, function () {
        var error_1, hints;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, exports.pg.query("SELECT 1")];
                case 1:
                    _a.sent();
                    return [2 /*return*/, true];
                case 2:
                    error_1 = _a.sent();
                    console.error("Database connection test failed:", error_1);
                    hints = databaseConnectionHints(error_1);
                    if (hints.length > 0) {
                        console.error("[pg] Troubleshooting:\n  - " + hints.join("\n  - "));
                    }
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Close database pool
 */
function closePool() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, exports.pg.end()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get products by IDs preserving the order of IDs
 */
function getProductsByIdsOrdered(ids) {
    return __awaiter(this, void 0, void 0, function () {
        var numericIds, result, productMap;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (ids.length === 0)
                        return [2 /*return*/, []];
                    numericIds = ids.map(function (id) { return typeof id === 'string' ? parseInt(id, 10) : id; });
                    return [4 /*yield*/, exports.pg.query("SELECT p.*, v.name as vendor_name\n     FROM products p\n     LEFT JOIN vendors v ON v.id = p.vendor_id\n     WHERE p.id = ANY($1::int[])", [numericIds])];
                case 1:
                    result = _a.sent();
                    productMap = new Map(result.rows.map(function (p) { return [String(p.id), p]; }));
                    return [2 /*return*/, numericIds.map(function (id) { return productMap.get(String(id)); }).filter(Boolean)];
            }
        });
    });
}
/**
 * Lightweight projection for search result cards.
 *
 * Avoid `SELECT p.*` on real-time search paths: product descriptions and other
 * enrichment blobs can be large, and the UI only needs card/list metadata here.
 */
function getSearchProductsByIdsOrdered(ids) {
    return __awaiter(this, void 0, void 0, function () {
        var numericIds, result, productMap;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (ids.length === 0)
                        return [2 /*return*/, []];
                    numericIds = ids
                        .map(function (id) { return (typeof id === "string" ? parseInt(id, 10) : id); })
                        .filter(function (id) { return Number.isFinite(id); });
                    if (numericIds.length === 0)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, exports.pg.query("SELECT\n       p.id,\n       p.title,\n       p.brand,\n       p.category,\n       COALESCE(p.currency, 'USD') AS currency,\n       p.price_cents,\n       p.sales_price_cents,\n       p.image_url,\n       p.image_cdn\n     FROM products p\n     WHERE p.id = ANY($1::int[])", [numericIds])];
                case 1:
                    result = _a.sent();
                    productMap = new Map(result.rows.map(function (p) { return [String(p.id), p]; }));
                    return [2 /*return*/, numericIds.map(function (id) { return productMap.get(String(id)); }).filter(Boolean)];
            }
        });
    });
}
