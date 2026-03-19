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
exports.loadImage = loadImage;
exports.normalizeImage = normalizeImage;
exports.pHash = pHash;
/**
 * Image Utilities
 *
 * Low-level image manipulation: loading, normalization, pHash computation.
 */
var sharp_1 = require("sharp");
// `sharp` is CommonJS callable, but TS/Node interop may expose it as `sharp.default`.
// If `.default` isn't callable, map it to the callable export.
if (typeof sharp_1.default !== "function") {
    sharp_1.default = sharp_1;
}
/**
 * Load image buffer into raw pixel data
 */
function loadImage(buffer) {
    return __awaiter(this, void 0, void 0, function () {
        var img, _a, data, info, channels;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    img = (0, sharp_1.default)(buffer);
                    return [4 /*yield*/, img.raw().ensureAlpha().toBuffer({ resolveWithObject: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, info = _a.info;
                    channels = info.channels;
                    return [2 /*return*/, { data: Buffer.from(data), width: info.width, height: info.height, channels: channels }];
            }
        });
    });
}
/**
 * Normalize image bytes to Float32Array in CHW order (channels first)
 * Scales pixels to [0,1] and applies optional mean/std normalization
 */
function normalizeImage(data, width, height, channels, options) {
    var _a, _b, _c, _d;
    var mean = (_a = options === null || options === void 0 ? void 0 : options.mean) !== null && _a !== void 0 ? _a : [0, 0, 0];
    var std = (_b = options === null || options === void 0 ? void 0 : options.std) !== null && _b !== void 0 ? _b : [1, 1, 1];
    var out = new Float32Array(channels * width * height);
    // If data has alpha channel (4), ignore alpha channel in normalization
    var useChannels = Math.min(channels, 3);
    for (var c = 0; c < useChannels; c++) {
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var srcIdx = (y * width + x) * channels + c;
                var dstIdx = c * width * height + y * width + x;
                var v = (data[srcIdx] & 0xff) / 255.0;
                out[dstIdx] = (v - ((_c = mean[c]) !== null && _c !== void 0 ? _c : 0)) / ((_d = std[c]) !== null && _d !== void 0 ? _d : 1);
            }
        }
    }
    return out;
}
/**
 * Compute perceptual hash (pHash) for an image buffer
 * Returns a 16-character hex string (64-bit hash)
 */
function pHash(buffer) {
    return __awaiter(this, void 0, void 0, function () {
        var resized, data, pixels, N, mat, y, x, dct, vals, y, x, median, bits, i, parity, hex, i, s;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, sharp_1.default)(buffer).resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true })];
                case 1:
                    resized = _a.sent();
                    data = resized.data;
                    pixels = Array.from(data).map(function (v) { return v & 0xff; });
                    N = 32;
                    mat = new Array(N);
                    for (y = 0; y < N; y++) {
                        mat[y] = new Array(N);
                        for (x = 0; x < N; x++) {
                            mat[y][x] = pixels[y * N + x];
                        }
                    }
                    dct = dct2d(mat);
                    vals = [];
                    for (y = 0; y < 8; y++) {
                        for (x = 0; x < 8; x++) {
                            if (y === 0 && x === 0)
                                continue; // skip DC
                            vals.push(dct[y][x]);
                        }
                    }
                    median = medianOfArray(vals);
                    bits = [];
                    for (i = 0; i < vals.length; i++) {
                        bits.push(vals[i] > median ? 1 : 0);
                    }
                    parity = bits.reduce(function (a, b) { return a ^ b; }, 0);
                    bits.push(parity);
                    hex = BigInt(0);
                    for (i = 0; i < bits.length; i++) {
                        if (bits[i]) {
                            hex = hex | (BigInt(1) << BigInt(bits.length - 1 - i));
                        }
                    }
                    s = hex.toString(16).padStart(16, "0");
                    return [2 /*return*/, s];
            }
        });
    });
}
function medianOfArray(arr) {
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}
// 2D DCT using separable DCT-II
function dct2d(mat) {
    var N = mat.length;
    var tmp = new Array(N).fill(null).map(function () { return new Array(N).fill(0); });
    var out = new Array(N).fill(null).map(function () { return new Array(N).fill(0); });
    // 1D DCT on rows
    for (var y = 0; y < N; y++) {
        tmp[y] = dct1d(mat[y]);
    }
    // 1D DCT on columns
    for (var x = 0; x < N; x++) {
        var col = new Array(N);
        for (var y = 0; y < N; y++)
            col[y] = tmp[y][x];
        var dcol = dct1d(col);
        for (var y = 0; y < N; y++)
            out[y][x] = dcol[y];
    }
    return out;
}
function dct1d(vec) {
    var N = vec.length;
    var out = new Array(N).fill(0);
    var factor = Math.PI / (2 * N);
    for (var k = 0; k < N; k++) {
        var sum = 0;
        for (var n = 0; n < N; n++) {
            sum += vec[n] * Math.cos((2 * n + 1) * k * factor);
        }
        var ck = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
        out[k] = ck * sum;
    }
    return out;
}
