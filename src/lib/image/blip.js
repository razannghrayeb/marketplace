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
exports.blip = exports.BlipService = void 0;
// src/lib/image/blip.ts
var ort = require("onnxruntime-node");
var sharp_1 = require("sharp");
var BLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
var BLIP_STD = [0.26862954, 0.26130258, 0.27577711];
var INPUT_SIZE = 384;
var MAX_NEW_TOKENS = 30;
// BLIP tokenizer special tokens (BERT-based)
var BOS_TOKEN_ID = 101; // [CLS]
var EOS_TOKEN_ID = 102; // [SEP]
var PAD_TOKEN_ID = 0;
var BlipService = /** @class */ (function () {
    function BlipService() {
        this.visionSession = null;
        this.decoderSession = null;
        this.tokenizer = null;
    }
    BlipService.prototype.init = function () {
        return __awaiter(this, void 0, void 0, function () {
            var AutoTokenizer, _a;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, Promise.all([
                            ort.InferenceSession.create('models/blip-vision.onnx', { executionProviders: ['cpu'] }),
                            ort.InferenceSession.create('models/blip-text-decoder.onnx', { executionProviders: ['cpu'] }),
                        ])];
                    case 1:
                        // Load both ONNX models in parallel
                        _b = _c.sent(), this.visionSession = _b[0], this.decoderSession = _b[1];
                        return [4 /*yield*/, Promise.resolve().then(function () { return require('@xenova/transformers'); })];
                    case 2:
                        AutoTokenizer = (_c.sent()).AutoTokenizer;
                        _a = this;
                        return [4 /*yield*/, AutoTokenizer.from_pretrained('Xenova/blip-image-captioning-base')];
                    case 3:
                        _a.tokenizer = _c.sent();
                        console.log('✅ BLIP vision + decoder ready');
                        return [2 /*return*/];
                }
            });
        });
    };
    // ── Main entry point ─────────────────────────────────────────────────
    BlipService.prototype.caption = function (imageBuffer) {
        return __awaiter(this, void 0, void 0, function () {
            var imageHiddenStates, tokenIds, caption;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.visionSession || !this.decoderSession) {
                            throw new Error('BlipService not initialized — call init() first');
                        }
                        return [4 /*yield*/, this.encodeImage(imageBuffer)];
                    case 1:
                        imageHiddenStates = _a.sent();
                        return [4 /*yield*/, this.generate(imageHiddenStates)];
                    case 2:
                        tokenIds = _a.sent();
                        return [4 /*yield*/, this.tokenizer.decode(tokenIds, {
                                skip_special_tokens: true,
                            })];
                    case 3:
                        caption = _a.sent();
                        return [2 /*return*/, caption.trim()];
                }
            });
        });
    };
    // ── Step 1: Vision Encoder ───────────────────────────────────────────
    BlipService.prototype.encodeImage = function (imageBuffer) {
        return __awaiter(this, void 0, void 0, function () {
            var pixels, tensor, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.preprocessImage(imageBuffer)];
                    case 1:
                        pixels = _a.sent();
                        tensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
                        return [4 /*yield*/, this.visionSession.run({ pixel_values: tensor })];
                    case 2:
                        output = _a.sent();
                        return [2 /*return*/, output['last_hidden_state']]; // shape: (1, 577, 768)
                }
            });
        });
    };
    // ── Step 2: Autoregressive Decode Loop ───────────────────────────────
    BlipService.prototype.generate = function (imageHiddenStates) {
        return __awaiter(this, void 0, void 0, function () {
            var generatedIds, step, inputIdsTensor, output, logits, vocabSize, lastLogits, nextTokenId;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        generatedIds = [BOS_TOKEN_ID];
                        step = 0;
                        _a.label = 1;
                    case 1:
                        if (!(step < MAX_NEW_TOKENS)) return [3 /*break*/, 4];
                        inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(generatedIds.map(BigInt)), [1, generatedIds.length]);
                        return [4 /*yield*/, this.decoderSession.run({
                                input_ids: inputIdsTensor,
                                image_hidden_states: imageHiddenStates,
                            })];
                    case 2:
                        output = _a.sent();
                        logits = output['logits'].data;
                        vocabSize = logits.length / generatedIds.length;
                        lastLogits = logits.slice((generatedIds.length - 1) * vocabSize, generatedIds.length * vocabSize);
                        nextTokenId = this.argmax(lastLogits);
                        // Stop if EOS
                        if (nextTokenId === EOS_TOKEN_ID)
                            return [3 /*break*/, 4];
                        generatedIds.push(nextTokenId);
                        _a.label = 3;
                    case 3:
                        step++;
                        return [3 /*break*/, 1];
                    case 4: 
                    // Strip BOS from output
                    return [2 /*return*/, generatedIds.slice(1)];
                }
            });
        });
    };
    // ── Helpers ──────────────────────────────────────────────────────────
    BlipService.prototype.argmax = function (arr) {
        var maxIdx = 0;
        var maxVal = -Infinity;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] > maxVal) {
                maxVal = arr[i];
                maxIdx = i;
            }
        }
        return maxIdx;
    };
    BlipService.prototype.preprocessImage = function (imageBuffer) {
        return __awaiter(this, void 0, void 0, function () {
            var data, float32, i, c;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, (0, sharp_1.default)(imageBuffer)
                            .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
                            .removeAlpha()
                            .raw()
                            .toBuffer({ resolveWithObject: true })];
                    case 1:
                        data = (_a.sent()).data;
                        float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
                        for (i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
                            for (c = 0; c < 3; c++) {
                                float32[c * INPUT_SIZE * INPUT_SIZE + i] =
                                    (data[i * 3 + c] / 255.0 - BLIP_MEAN[c]) / BLIP_STD[c];
                            }
                        }
                        return [2 /*return*/, float32];
                }
            });
        });
    };
    return BlipService;
}());
exports.BlipService = BlipService;
exports.blip = new BlipService();
