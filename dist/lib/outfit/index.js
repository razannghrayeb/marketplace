"use strict";
/**
 * Outfit Module Exports
 *
 * Complete My Style - Fashion outfit recommendation engine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_WHEEL = exports.CATEGORY_PAIRINGS = exports.CATEGORY_KEYWORDS = exports.getAnalogousColors = exports.getComplementaryColors = exports.getColorHarmonies = exports.buildStyleProfile = exports.detectColor = exports.detectCategory = exports.getProductForOutfit = exports.completeOutfitFromProductId = exports.completeMyStyle = void 0;
var completestyle_1 = require("./completestyle");
// Main functions
Object.defineProperty(exports, "completeMyStyle", { enumerable: true, get: function () { return completestyle_1.completeMyStyle; } });
Object.defineProperty(exports, "completeOutfitFromProductId", { enumerable: true, get: function () { return completestyle_1.completeOutfitFromProductId; } });
Object.defineProperty(exports, "getProductForOutfit", { enumerable: true, get: function () { return completestyle_1.getProductForOutfit; } });
// Detection functions
Object.defineProperty(exports, "detectCategory", { enumerable: true, get: function () { return completestyle_1.detectCategory; } });
Object.defineProperty(exports, "detectColor", { enumerable: true, get: function () { return completestyle_1.detectColor; } });
Object.defineProperty(exports, "buildStyleProfile", { enumerable: true, get: function () { return completestyle_1.buildStyleProfile; } });
// Color utilities
Object.defineProperty(exports, "getColorHarmonies", { enumerable: true, get: function () { return completestyle_1.getColorHarmonies; } });
Object.defineProperty(exports, "getComplementaryColors", { enumerable: true, get: function () { return completestyle_1.getComplementaryColors; } });
Object.defineProperty(exports, "getAnalogousColors", { enumerable: true, get: function () { return completestyle_1.getAnalogousColors; } });
// Constants
Object.defineProperty(exports, "CATEGORY_KEYWORDS", { enumerable: true, get: function () { return completestyle_1.CATEGORY_KEYWORDS; } });
Object.defineProperty(exports, "CATEGORY_PAIRINGS", { enumerable: true, get: function () { return completestyle_1.CATEGORY_PAIRINGS; } });
Object.defineProperty(exports, "COLOR_WHEEL", { enumerable: true, get: function () { return completestyle_1.COLOR_WHEEL; } });
