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
exports.r2Client = void 0;
exports.generateImageKey = generateImageKey;
exports.uploadImage = uploadImage;
exports.uploadImageFromUrl = uploadImageFromUrl;
exports.getSignedImageUrl = getSignedImageUrl;
exports.imageExists = imageExists;
exports.deleteImage = deleteImage;
exports.getCdnUrl = getCdnUrl;
/**
 * R2 Storage Service
 *
 * Cloudflare R2 storage for images using S3-compatible API.
 */
var client_s3_1 = require("@aws-sdk/client-s3");
var s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
var config_1 = require("../../config");
var crypto_1 = require("crypto");
var r2 = config_1.config.r2;
// R2 uses S3-compatible API
exports.r2Client = new client_s3_1.S3Client({
    region: "auto",
    endpoint: "https://".concat(r2.accountId, ".r2.cloudflarestorage.com"),
    credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
    },
});
/**
 * Generate a unique key for an image based on content hash
 */
function generateImageKey(buffer, ext) {
    if (ext === void 0) { ext = ".jpg"; }
    var hash = crypto_1.default.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    var timestamp = Date.now().toString(36);
    return "images/".concat(timestamp, "-").concat(hash).concat(ext);
}
/**
 * Upload an image buffer to R2
 * Returns the public CDN URL
 */
function uploadImage(buffer_1, key_1) {
    return __awaiter(this, arguments, void 0, function (buffer, key, contentType) {
        var finalKey, cdnUrl;
        if (contentType === void 0) { contentType = "image/jpeg"; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    finalKey = key || generateImageKey(buffer, ".jpg");
                    return [4 /*yield*/, exports.r2Client.send(new client_s3_1.PutObjectCommand({
                            Bucket: r2.bucket,
                            Key: finalKey,
                            Body: buffer,
                            ContentType: contentType,
                            CacheControl: "public, max-age=31536000, immutable",
                        }))];
                case 1:
                    _a.sent();
                    cdnUrl = "".concat(r2.publicBaseUrl, "/").concat(finalKey);
                    return [2 /*return*/, { key: finalKey, cdnUrl: cdnUrl }];
            }
        });
    });
}
/**
 * Upload image from a URL to R2
 */
function uploadImageFromUrl(imageUrl) {
    return __awaiter(this, void 0, void 0, function () {
        var response, buffer, _a, _b, contentType, ext, err_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, fetch(imageUrl, { signal: AbortSignal.timeout(30000) })];
                case 1:
                    response = _c.sent();
                    if (!response.ok)
                        throw new Error("HTTP ".concat(response.status));
                    _b = (_a = Buffer).from;
                    return [4 /*yield*/, response.arrayBuffer()];
                case 2:
                    buffer = _b.apply(_a, [_c.sent()]);
                    contentType = response.headers.get("content-type") || "image/jpeg";
                    ext = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
                    return [4 /*yield*/, uploadImage(buffer, generateImageKey(buffer, ext), contentType)];
                case 3: return [2 /*return*/, _c.sent()];
                case 4:
                    err_1 = _c.sent();
                    console.error("Failed to upload image from URL ".concat(imageUrl, ":"), err_1);
                    return [2 /*return*/, null];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Generate a signed URL for private access (expires in 1 hour by default)
 */
function getSignedImageUrl(key_1) {
    return __awaiter(this, arguments, void 0, function (key, expiresIn) {
        var command;
        if (expiresIn === void 0) { expiresIn = 3600; }
        return __generator(this, function (_a) {
            command = new client_s3_1.GetObjectCommand({
                Bucket: r2.bucket,
                Key: key,
            });
            return [2 /*return*/, (0, s3_request_presigner_1.getSignedUrl)(exports.r2Client, command, { expiresIn: expiresIn })];
        });
    });
}
/**
 * Check if an object exists in R2
 */
function imageExists(key) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, exports.r2Client.send(new client_s3_1.HeadObjectCommand({
                            Bucket: r2.bucket,
                            Key: key,
                        }))];
                case 1:
                    _b.sent();
                    return [2 /*return*/, true];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Delete an image from R2
 */
function deleteImage(key) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, exports.r2Client.send(new client_s3_1.DeleteObjectCommand({
                        Bucket: r2.bucket,
                        Key: key,
                    }))];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get the public CDN URL for a key
 */
function getCdnUrl(key) {
    return "".concat(r2.publicBaseUrl, "/").concat(key);
}
