"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIndexStats = exports.recreateIndex = exports.ensureIndex = exports.osClient = exports.getProductsByIdsOrdered = exports.closePool = exports.testConnection = exports.pg = void 0;
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
var opensearch_1 = require("./opensearch");
Object.defineProperty(exports, "osClient", { enumerable: true, get: function () { return opensearch_1.osClient; } });
Object.defineProperty(exports, "ensureIndex", { enumerable: true, get: function () { return opensearch_1.ensureIndex; } });
Object.defineProperty(exports, "recreateIndex", { enumerable: true, get: function () { return opensearch_1.recreateIndex; } });
Object.defineProperty(exports, "getIndexStats", { enumerable: true, get: function () { return opensearch_1.getIndexStats; } });
