"use strict";
/**
 * Google Cloud Vertex AI Virtual Try-On Client
 *
 * Calls the Vertex AI Virtual Try-On API — no GPU, no local model, no Python service.
 *
 * Setup:
 *   1. Enable Vertex AI API in your GCP project:
 *      gcloud services enable aiplatform.googleapis.com
 *   2. Set GCLOUD_PROJECT env var to your GCP project ID
 *   3. Authenticate (pick one):
 *      - Local dev:  gcloud auth application-default login
 *      - Service account: set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 */
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
exports.TryOnClient = void 0;
exports.getTryOnClient = getTryOnClient;
var google_auth_library_1 = require("google-auth-library");
var config_1 = require("../../config");
// ============================================================================
// Client Class
// ============================================================================
var TryOnClient = /** @class */ (function () {
    function TryOnClient(opts) {
        var _a, _b, _c, _d;
        this.project = (_a = opts === null || opts === void 0 ? void 0 : opts.project) !== null && _a !== void 0 ? _a : config_1.config.tryon.project;
        this.location = (_b = opts === null || opts === void 0 ? void 0 : opts.location) !== null && _b !== void 0 ? _b : config_1.config.tryon.location;
        this.model = (_c = opts === null || opts === void 0 ? void 0 : opts.model) !== null && _c !== void 0 ? _c : config_1.config.tryon.model;
        this.timeout = (_d = opts === null || opts === void 0 ? void 0 : opts.timeout) !== null && _d !== void 0 ? _d : config_1.config.tryon.timeout;
        this.auth = new google_auth_library_1.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
    }
    Object.defineProperty(TryOnClient.prototype, "endpoint", {
        get: function () {
            return ("https://".concat(this.location, "-aiplatform.googleapis.com/v1") +
                "/projects/".concat(this.project, "/locations/").concat(this.location) +
                "/publishers/google/models/".concat(this.model, ":predict"));
        },
        enumerable: false,
        configurable: true
    });
    // -------------------------------------------------------------------------
    // Auth
    // -------------------------------------------------------------------------
    TryOnClient.prototype.getBearerToken = function () {
        return __awaiter(this, void 0, void 0, function () {
            var client, tokenRes, token;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.auth.getClient()];
                    case 1:
                        client = _b.sent();
                        return [4 /*yield*/, client.getAccessToken()];
                    case 2:
                        tokenRes = _b.sent();
                        token = (_a = tokenRes === null || tokenRes === void 0 ? void 0 : tokenRes.token) !== null && _a !== void 0 ? _a : tokenRes;
                        if (!token)
                            throw new Error("Failed to obtain Google Cloud access token");
                        return [2 /*return*/, String(token)];
                }
            });
        });
    };
    // -------------------------------------------------------------------------
    // Health / Availability
    // -------------------------------------------------------------------------
    TryOnClient.prototype.isAvailable = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.getBearerToken()];
                    case 1:
                        _b.sent();
                        return [2 /*return*/, this.project.length > 0];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    TryOnClient.prototype.health = function () {
        return __awaiter(this, void 0, void 0, function () {
            var credentialsOk;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.isAvailable()];
                    case 1:
                        credentialsOk = _a.sent();
                        return [2 /*return*/, {
                                ok: credentialsOk,
                                model_loaded: true, // managed — always loaded
                                gpu_available: false, // no local GPU needed
                                gpu_name: null,
                                vram_total_gb: null,
                                vram_used_gb: null,
                                preprocessing_models: {
                                    densepose: true,
                                    human_parse: true,
                                    openpose: true,
                                },
                                project: this.project,
                                location: this.location,
                                model: this.model,
                                version: "vertex-ai",
                            }];
                }
            });
        });
    };
    // -------------------------------------------------------------------------
    // Core inference
    // -------------------------------------------------------------------------
    /**
     * Run virtual try-on from image Buffers.
     * person + garment → result image (base64 PNG)
     */
    TryOnClient.prototype.tryOnFromBuffers = function (personBuffer_1, garmentBuffer_1) {
        return __awaiter(this, arguments, void 0, function (personBuffer, garmentBuffer, options) {
            var start, token, body, response, err, json, prediction, processing_time_ms;
            var _a, _b, _c;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!this.project) {
                            throw new Error("GCLOUD_PROJECT env var is required for Vertex AI Virtual Try-On");
                        }
                        start = Date.now();
                        return [4 /*yield*/, this.getBearerToken()];
                    case 1:
                        token = _d.sent();
                        body = {
                            instances: [
                                {
                                    person_image: {
                                        bytesBase64Encoded: personBuffer.toString("base64"),
                                    },
                                    product_image: {
                                        bytesBase64Encoded: garmentBuffer.toString("base64"),
                                    },
                                },
                            ],
                            parameters: {
                                editConfig: {
                                    numberOfImages: (_a = options.numberOfImages) !== null && _a !== void 0 ? _a : 1,
                                },
                            },
                        };
                        return [4 /*yield*/, fetch(this.endpoint, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: "Bearer ".concat(token),
                                },
                                body: JSON.stringify(body),
                                signal: AbortSignal.timeout(this.timeout),
                            })];
                    case 2:
                        response = _d.sent();
                        if (!!response.ok) return [3 /*break*/, 4];
                        return [4 /*yield*/, response.text()];
                    case 3:
                        err = _d.sent();
                        throw new Error("Vertex AI Virtual Try-On failed: ".concat(response.status, " - ").concat(err));
                    case 4: return [4 /*yield*/, response.json()];
                    case 5:
                        json = (_d.sent());
                        prediction = (_b = json.predictions) === null || _b === void 0 ? void 0 : _b[0];
                        if (!(prediction === null || prediction === void 0 ? void 0 : prediction.bytesBase64Encoded)) {
                            throw new Error("Vertex AI returned no prediction image");
                        }
                        processing_time_ms = Date.now() - start;
                        return [2 /*return*/, {
                                success: true,
                                image_base64: prediction.bytesBase64Encoded,
                                image_width: 0, // Vertex AI does not return dimensions
                                image_height: 0,
                                processing_time_ms: processing_time_ms,
                                preprocessing_time_ms: 0, // handled server-side by Google
                                inference_time_ms: processing_time_ms,
                                seed_used: 0, // not applicable
                                category: (_c = options.category) !== null && _c !== void 0 ? _c : "upper_body",
                            }];
                }
            });
        });
    };
    /**
     * Run try-on from image URLs (downloads then sends)
     */
    TryOnClient.prototype.tryOnFromUrls = function (personImageUrl_1, garmentImageUrl_1) {
        return __awaiter(this, arguments, void 0, function (personImageUrl, garmentImageUrl, options) {
            var _a, personBuf, garmentBuf;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, Promise.all([
                            this.downloadImage(personImageUrl),
                            this.downloadImage(garmentImageUrl),
                        ])];
                    case 1:
                        _a = _b.sent(), personBuf = _a[0], garmentBuf = _a[1];
                        return [2 /*return*/, this.tryOnFromBuffers(personBuf, garmentBuf, options)];
                }
            });
        });
    };
    /**
     * Batch: same person, multiple garments — runs requests in parallel
     */
    TryOnClient.prototype.tryOnBatch = function (personBuffer_1, garments_1) {
        return __awaiter(this, arguments, void 0, function (personBuffer, garments, options) {
            var batchStart, results;
            var _this = this;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        batchStart = Date.now();
                        return [4 /*yield*/, Promise.all(garments.map(function (g) {
                                return _this.tryOnFromBuffers(personBuffer, g.buffer, __assign(__assign({}, options), { garmentDescription: g.description }));
                            }))];
                    case 1:
                        results = _a.sent();
                        return [2 /*return*/, {
                                success: true,
                                results: results,
                                total_time_ms: Date.now() - batchStart,
                            }];
                }
            });
        });
    };
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    TryOnClient.prototype.downloadImage = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var resp, _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, fetch(url, { signal: AbortSignal.timeout(15000) })];
                    case 1:
                        resp = _c.sent();
                        if (!resp.ok) {
                            throw new Error("Failed to download image: ".concat(resp.status));
                        }
                        _b = (_a = Buffer).from;
                        return [4 /*yield*/, resp.arrayBuffer()];
                    case 2: return [2 /*return*/, _b.apply(_a, [_c.sent()])];
                }
            });
        });
    };
    return TryOnClient;
}());
exports.TryOnClient = TryOnClient;
// ============================================================================
// Singleton Instance
// ============================================================================
var clientInstance = null;
function getTryOnClient() {
    if (!clientInstance) {
        clientInstance = new TryOnClient();
    }
    return clientInstance;
}
