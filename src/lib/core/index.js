"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CIRCUIT_CONFIGS = exports.isCircuitHealthy = exports.getAllCircuitStats = exports.withCircuitBreaker = exports.getCircuit = exports.CircuitOpenError = exports.CircuitBreaker = exports.warmupKnnIndex = exports.applyIndexSpeedSettings = exports.getIndexStats = exports.recreateIndex = exports.ensureIndex = exports.osClient = exports.toPgVectorParam = exports.queryWithPgCapacityRetry = exports.isPgCapacityError = exports.productsTableHasGenderColumn = exports.productsTableHasCanonicalIdColumn = exports.productsTableHasIsHiddenColumn = exports.getSearchProductsByIdsOrdered = exports.getProductsByIdsOrdered = exports.closePool = exports.testConnection = exports.pg = void 0;
/**
 * Core Infrastructure Exports
 *
 * Database and search infrastructure.
 */
require("dotenv/config");
var db_1 = require("./db");
Object.defineProperty(exports, "pg", { enumerable: true, get: function () { return db_1.pg; } });
Object.defineProperty(exports, "testConnection", { enumerable: true, get: function () { return db_1.testConnection; } });
Object.defineProperty(exports, "closePool", { enumerable: true, get: function () { return db_1.closePool; } });
Object.defineProperty(exports, "getProductsByIdsOrdered", { enumerable: true, get: function () { return db_1.getProductsByIdsOrdered; } });
Object.defineProperty(exports, "getSearchProductsByIdsOrdered", { enumerable: true, get: function () { return db_1.getSearchProductsByIdsOrdered; } });
Object.defineProperty(exports, "productsTableHasIsHiddenColumn", { enumerable: true, get: function () { return db_1.productsTableHasIsHiddenColumn; } });
Object.defineProperty(exports, "productsTableHasCanonicalIdColumn", { enumerable: true, get: function () { return db_1.productsTableHasCanonicalIdColumn; } });
Object.defineProperty(exports, "productsTableHasGenderColumn", { enumerable: true, get: function () { return db_1.productsTableHasGenderColumn; } });
Object.defineProperty(exports, "isPgCapacityError", { enumerable: true, get: function () { return db_1.isPgCapacityError; } });
Object.defineProperty(exports, "queryWithPgCapacityRetry", { enumerable: true, get: function () { return db_1.queryWithPgCapacityRetry; } });
Object.defineProperty(exports, "toPgVectorParam", { enumerable: true, get: function () { return db_1.toPgVectorParam; } });
var opensearch_1 = require("./opensearch");
Object.defineProperty(exports, "osClient", { enumerable: true, get: function () { return opensearch_1.osClient; } });
Object.defineProperty(exports, "ensureIndex", { enumerable: true, get: function () { return opensearch_1.ensureIndex; } });
Object.defineProperty(exports, "recreateIndex", { enumerable: true, get: function () { return opensearch_1.recreateIndex; } });
Object.defineProperty(exports, "getIndexStats", { enumerable: true, get: function () { return opensearch_1.getIndexStats; } });
Object.defineProperty(exports, "applyIndexSpeedSettings", { enumerable: true, get: function () { return opensearch_1.applyIndexSpeedSettings; } });
Object.defineProperty(exports, "warmupKnnIndex", { enumerable: true, get: function () { return opensearch_1.warmupKnnIndex; } });
var circuitBreaker_1 = require("./circuitBreaker");
Object.defineProperty(exports, "CircuitBreaker", { enumerable: true, get: function () { return circuitBreaker_1.CircuitBreaker; } });
Object.defineProperty(exports, "CircuitOpenError", { enumerable: true, get: function () { return circuitBreaker_1.CircuitOpenError; } });
Object.defineProperty(exports, "getCircuit", { enumerable: true, get: function () { return circuitBreaker_1.getCircuit; } });
Object.defineProperty(exports, "withCircuitBreaker", { enumerable: true, get: function () { return circuitBreaker_1.withCircuitBreaker; } });
Object.defineProperty(exports, "getAllCircuitStats", { enumerable: true, get: function () { return circuitBreaker_1.getAllCircuitStats; } });
Object.defineProperty(exports, "isCircuitHealthy", { enumerable: true, get: function () { return circuitBreaker_1.isCircuitHealthy; } });
Object.defineProperty(exports, "CIRCUIT_CONFIGS", { enumerable: true, get: function () { return circuitBreaker_1.CIRCUIT_CONFIGS; } });
