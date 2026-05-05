"use strict";
/**
 * Circuit Breaker Pattern for External API Resilience
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * when external services (Vertex AI, Gemini, OpenSearch) are unavailable.
 */
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.CircuitOpenError = exports.CircuitBreaker = exports.CIRCUIT_CONFIGS = void 0;
exports.getCircuit = getCircuit;
exports.withCircuitBreaker = withCircuitBreaker;
exports.getAllCircuitStats = getAllCircuitStats;
exports.isCircuitHealthy = isCircuitHealthy;
// ============================================================================
// Default Configurations
// ============================================================================
var DEFAULT_CONFIG = {
    failureThreshold: 5,
    resetTimeoutMs: 30000, // 30 seconds
    halfOpenMaxCalls: 3,
    successThreshold: 2,
};
exports.CIRCUIT_CONFIGS = {
    "vertex-ai": {
        name: "vertex-ai",
        failureThreshold: 3,
        resetTimeoutMs: 60000, // 1 minute (Vertex AI failures often persist)
        halfOpenMaxCalls: 2,
        successThreshold: 2,
    },
    "gemini": {
        name: "gemini",
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenMaxCalls: 3,
        successThreshold: 2,
    },
    "opensearch": {
        name: "opensearch",
        failureThreshold: 5,
        resetTimeoutMs: 10000, // 10 seconds (local service)
        halfOpenMaxCalls: 5,
        successThreshold: 3,
    },
    "ranker": {
        name: "ranker",
        failureThreshold: 3,
        resetTimeoutMs: 15000,
        halfOpenMaxCalls: 2,
        successThreshold: 2,
    },
    /** CLIP text ONNX — single-threaded CPU; parallel bursts were falsely tripping the breaker */
    "clip-text": {
        name: "clip-text",
        failureThreshold: 20,
        resetTimeoutMs: 8000,
        halfOpenMaxCalls: 8,
        successThreshold: 2,
    },
    /** CLIP image ONNX — same rationale as clip-text for batch reindex */
    clip: {
        name: "clip",
        failureThreshold: 20,
        resetTimeoutMs: 8000,
        halfOpenMaxCalls: 8,
        successThreshold: 2,
    },
};
// ============================================================================
// Circuit Breaker Implementation
// ============================================================================
var CircuitBreaker = /** @class */ (function () {
    function CircuitBreaker(config) {
        this.config = config;
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastSuccessTime = null;
        this.halfOpenCalls = 0;
        this.halfOpenFailures = 0;
        this.totalCalls = 0;
        this.totalFailures = 0;
    }
    /**
     * Execute a function with circuit breaker protection
     */
    CircuitBreaker.prototype.execute = function (fn) {
        return __awaiter(this, void 0, void 0, function () {
            var result, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.canExecute()) {
                            throw new CircuitOpenError(this.config.name, this.getResetTime());
                        }
                        this.totalCalls++;
                        if (this.state === "half-open") {
                            this.halfOpenCalls++;
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fn()];
                    case 2:
                        result = _a.sent();
                        this.onSuccess();
                        return [2 /*return*/, result];
                    case 3:
                        error_1 = _a.sent();
                        this.onFailure();
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if execution is allowed
     */
    CircuitBreaker.prototype.canExecute = function () {
        switch (this.state) {
            case "closed":
                return true;
            case "open":
                // Check if reset timeout has elapsed
                if (this.shouldAttemptReset()) {
                    this.transitionToHalfOpen();
                    return true;
                }
                return false;
            case "half-open":
                return this.halfOpenCalls < this.config.halfOpenMaxCalls;
        }
    };
    /**
     * Record a successful call
     */
    CircuitBreaker.prototype.onSuccess = function () {
        this.lastSuccessTime = new Date();
        switch (this.state) {
            case "closed":
                this.failures = 0;
                break;
            case "half-open":
                this.successes++;
                if (this.successes >= this.config.successThreshold) {
                    this.transitionToClosed();
                }
                break;
        }
    };
    /**
     * Record a failed call
     */
    CircuitBreaker.prototype.onFailure = function () {
        this.lastFailureTime = new Date();
        this.totalFailures++;
        switch (this.state) {
            case "closed":
                this.failures++;
                if (this.failures >= this.config.failureThreshold) {
                    this.transitionToOpen();
                }
                break;
            case "half-open":
                this.halfOpenFailures++;
                // Only reopen if majority of half-open probes fail, not on a single failure.
                // This prevents the circuit from being permanently stuck OPEN when a
                // transient error (e.g. tokenizer init delay) hits the first probe call.
                if (this.halfOpenFailures >= Math.max(2, Math.ceil(this.config.halfOpenMaxCalls / 2))) {
                    this.transitionToOpen();
                }
                break;
        }
    };
    CircuitBreaker.prototype.shouldAttemptReset = function () {
        if (!this.lastFailureTime)
            return true;
        var elapsed = Date.now() - this.lastFailureTime.getTime();
        return elapsed >= this.config.resetTimeoutMs;
    };
    CircuitBreaker.prototype.getResetTime = function () {
        if (!this.lastFailureTime)
            return 0;
        var elapsed = Date.now() - this.lastFailureTime.getTime();
        return Math.max(0, this.config.resetTimeoutMs - elapsed);
    };
    CircuitBreaker.prototype.transitionToOpen = function () {
        console.warn("[CircuitBreaker] ".concat(this.config.name, ": OPEN (failures: ").concat(this.failures, ")"));
        this.state = "open";
        this.halfOpenCalls = 0;
        this.halfOpenFailures = 0;
        this.successes = 0;
    };
    CircuitBreaker.prototype.transitionToHalfOpen = function () {
        console.info("[CircuitBreaker] ".concat(this.config.name, ": HALF-OPEN (attempting recovery)"));
        this.state = "half-open";
        this.halfOpenCalls = 0;
        this.halfOpenFailures = 0;
        this.successes = 0;
    };
    CircuitBreaker.prototype.transitionToClosed = function () {
        console.info("[CircuitBreaker] ".concat(this.config.name, ": CLOSED (recovered)"));
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
        this.halfOpenCalls = 0;
        this.halfOpenFailures = 0;
    };
    /**
     * Get current circuit stats
     */
    CircuitBreaker.prototype.getStats = function () {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailure: this.lastFailureTime,
            lastSuccess: this.lastSuccessTime,
            totalCalls: this.totalCalls,
            totalFailures: this.totalFailures,
        };
    };
    /**
     * Force reset the circuit (for testing/admin)
     */
    CircuitBreaker.prototype.reset = function () {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
        this.halfOpenCalls = 0;
        this.halfOpenFailures = 0;
    };
    return CircuitBreaker;
}());
exports.CircuitBreaker = CircuitBreaker;
// ============================================================================
// Circuit Open Error
// ============================================================================
var CircuitOpenError = /** @class */ (function (_super) {
    __extends(CircuitOpenError, _super);
    function CircuitOpenError(circuitName, resetInMs) {
        var _this = _super.call(this, "Circuit breaker ".concat(circuitName, " is OPEN. Retry in ").concat(Math.ceil(resetInMs / 1000), "s")) || this;
        _this.circuitName = circuitName;
        _this.resetInMs = resetInMs;
        _this.name = "CircuitOpenError";
        return _this;
    }
    return CircuitOpenError;
}(Error));
exports.CircuitOpenError = CircuitOpenError;
// ============================================================================
// Circuit Breaker Registry
// ============================================================================
var circuits = new Map();
/**
 * Get or create a circuit breaker by name
 */
function getCircuit(name) {
    var _a;
    if (!circuits.has(name)) {
        var config = (_a = exports.CIRCUIT_CONFIGS[name]) !== null && _a !== void 0 ? _a : __assign({ name: name }, DEFAULT_CONFIG);
        circuits.set(name, new CircuitBreaker(config));
    }
    return circuits.get(name);
}
/**
 * Execute with circuit breaker by name
 */
function withCircuitBreaker(name, fn) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, getCircuit(name).execute(fn)];
        });
    });
}
/**
 * Get all circuit stats (for health endpoint)
 */
function getAllCircuitStats() {
    var stats = {};
    for (var _i = 0, circuits_1 = circuits; _i < circuits_1.length; _i++) {
        var _a = circuits_1[_i], name_1 = _a[0], circuit = _a[1];
        stats[name_1] = circuit.getStats();
    }
    return stats;
}
/**
 * Check if a specific circuit is healthy (closed or half-open)
 */
function isCircuitHealthy(name) {
    var circuit = circuits.get(name);
    if (!circuit)
        return true; // Not registered = healthy
    var stats = circuit.getStats();
    return stats.state !== "open";
}
