"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var searchHitRelevance_1 = require("./searchHitRelevance");
var productTypeTaxonomy_1 = require("./productTypeTaxonomy");
describe("computeHitRelevance - sleeve intent", function () {
    test("short-sleeve intent penalizes long-sleeve product", function () {
        var hit = {
            _source: {
                title: "Men Long Sleeve Shirt",
                category: "shirts",
                category_canonical: "tops",
                product_types: ["shirt"],
                attr_sleeve: "long-sleeve",
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hit, 0.86, {
            desiredProductTypes: ["tshirt", "tee"],
            desiredColors: [],
            desiredColorsTier: [],
            desiredStyle: "casual",
            desiredSleeve: "short",
            rerankColorMode: "any",
            mergedCategory: "tops",
            astCategories: ["tops"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
        });
        expect(rel.sleeveCompliance).toBeLessThan(0.3);
        expect(rel.finalRelevance01).toBeLessThan(0.75);
    });
    test("matching sleeve intent boosts compliance", function () {
        var hit = {
            _source: {
                title: "Men Short Sleeve T-Shirt",
                category: "t-shirts",
                category_canonical: "tops",
                product_types: ["tshirt", "tee"],
                attr_sleeve: "short-sleeve",
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hit, 0.86, {
            desiredProductTypes: ["tshirt", "tee"],
            desiredColors: [],
            desiredColorsTier: [],
            desiredStyle: "casual",
            desiredSleeve: "short",
            rerankColorMode: "any",
            mergedCategory: "tops",
            astCategories: ["tops"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
        });
        expect(rel.sleeveCompliance).toBe(1);
        expect(rel.finalRelevance01).toBeGreaterThan(0.75);
    });
    test("keeps inferred short sleeve conservative when sleeve metadata is missing", function () {
        var hit = {
            _source: {
                title: "Men Core Tee",
                category: "T-Shirts",
                category_canonical: "tops",
                product_types: ["tee"],
                attr_sleeve: null,
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hit, 0.84, {
            desiredProductTypes: ["tshirt", "tee"],
            desiredColors: [],
            desiredColorsTier: [],
            desiredStyle: "casual",
            desiredSleeve: "short",
            rerankColorMode: "any",
            mergedCategory: "tops",
            astCategories: ["tops"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
        });
        expect(rel.sleeveCompliance).toBeGreaterThan(0.2);
        expect(rel.sleeveCompliance).toBeLessThan(0.4);
    });
});
describe("scoreCrossFamilyTypePenalty - category fallback", function () {
    test("tops query vs empty product_types + footwear canonical still penalizes", function () {
        var p = (0, productTypeTaxonomy_1.scoreCrossFamilyTypePenalty)(["shirt"], [], {
            categoryCanonical: "footwear",
            category: "athletic shoes",
        });
        expect(p).toBeGreaterThanOrEqual(0.8);
    });
    test("tops query vs shoes category string with no types still penalizes", function () {
        var p = (0, productTypeTaxonomy_1.scoreCrossFamilyTypePenalty)(["tee"], [], {
            category: "Men's Running Shoes",
        });
        expect(p).toBeGreaterThanOrEqual(0.8);
    });
});
describe("computeHitRelevance - type intent reliability", function () {
    var footwearHit = {
        _source: {
            title: "Running Sneaker",
            category: "shoes",
            category_canonical: "footwear",
            product_types: ["sneaker", "shoes"],
            attr_sleeve: null,
        },
    };
    test("weak inferred type hints do not hard-zero high visual matches", function () {
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(footwearHit, 0.92, {
            desiredProductTypes: ["dress"],
            desiredColors: [],
            desiredColorsTier: [],
            rerankColorMode: "any",
            mergedCategory: "dresses",
            astCategories: ["dresses"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
            reliableTypeIntent: false,
        });
        expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
        expect(rel.finalRelevance01).toBeGreaterThan(0.45);
    });
    test("reliable type intent still enforces strict cross-family blocking", function () {
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(footwearHit, 0.92, {
            desiredProductTypes: ["dress"],
            desiredColors: [],
            desiredColorsTier: [],
            rerankColorMode: "any",
            mergedCategory: "dresses",
            astCategories: ["dresses"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
            reliableTypeIntent: true,
        });
        expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
        expect(rel.finalRelevance01).toBeLessThan(0.2);
    });
    test("shirt intent vs footwear listing with missing product_types uses category penalty", function () {
        var hitNoTypes = {
            _source: {
                title: "Running Sneaker",
                category: "shoes",
                category_canonical: "footwear",
                product_types: [],
                attr_sleeve: null,
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hitNoTypes, 0.92, {
            desiredProductTypes: ["shirt", "tee"],
            desiredColors: [],
            desiredColorsTier: [],
            rerankColorMode: "any",
            mergedCategory: "tops",
            astCategories: ["tops"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
            reliableTypeIntent: true,
        });
        expect(rel.crossFamilyPenalty).toBeGreaterThanOrEqual(0.8);
        expect(rel.finalRelevance01).toBeLessThan(0.2);
    });
});
describe("computeHitRelevance - color typo normalization", function () {
    test("tops color intent caps mismatched color relevance", function () {
        var hit = {
            _source: {
                title: "Women Red Cotton Shirt",
                category: "shirts",
                category_canonical: "tops",
                product_types: ["shirt"],
                color: "red",
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hit, 0.92, {
            desiredProductTypes: ["shirt"],
            desiredColors: ["blue"],
            desiredColorsTier: ["blue"],
            rerankColorMode: "any",
            mergedCategory: "tops",
            astCategories: ["tops"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
            reliableTypeIntent: true,
        });
        expect(rel.colorCompliance).toBeLessThan(0.2);
        expect(rel.finalRelevance01).toBeLessThan(0.2);
    });
    test("pink intent matches catalog color typo fuhsia", function () {
        var hit = {
            _source: {
                title: "Women Satin Slip Dress",
                category: "dresses",
                category_canonical: "dresses",
                product_types: ["dress"],
                color: "fuhsia",
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hit, 0.84, {
            desiredProductTypes: ["dress"],
            desiredColors: ["pink"],
            desiredColorsTier: ["pink"],
            rerankColorMode: "any",
            mergedCategory: "dresses",
            astCategories: ["dresses"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
            reliableTypeIntent: true,
        });
        expect(rel.colorCompliance).toBeGreaterThan(0.7);
        expect(rel.colorTier === "exact" || rel.colorTier === "family").toBe(true);
    });
    test("pink intent matches color list typo fuschia", function () {
        var hit = {
            _source: {
                title: "Women Pleated Skirt",
                category: "skirts",
                category_canonical: "bottoms",
                product_types: ["skirt"],
                attr_colors: ["fuschia"],
            },
        };
        var rel = (0, searchHitRelevance_1.computeHitRelevance)(hit, 0.81, {
            desiredProductTypes: ["skirt"],
            desiredColors: ["pink"],
            desiredColorsTier: ["pink"],
            rerankColorMode: "any",
            mergedCategory: "bottoms",
            astCategories: ["bottoms"],
            hasAudienceIntent: false,
            crossFamilyPenaltyWeight: 420,
            tightSemanticCap: true,
            reliableTypeIntent: true,
        });
        expect(rel.colorCompliance).toBeGreaterThan(0.7);
        expect(rel.colorTier === "exact" || rel.colorTier === "family").toBe(true);
    });
});
describe("scoreAudienceCompliance - cue-based gender inference", function () {
    test("women query is penalized by masculine style cues even without gender words", function () {
        var hit = {
            _source: {
                title: "Tailored Oxford Shirt",
                category: "shirts",
                category_canonical: "tops",
                product_types: ["shirt", "oxford"],
            },
        };
        var compliance = (0, searchHitRelevance_1.scoreAudienceCompliance)(undefined, "women", hit);
        expect(compliance).toBeLessThan(0.4);
    });
    test("men query is penalized by feminine style cues even without gender words", function () {
        var hit = {
            _source: {
                title: "Floral Blouse",
                category: "shirts",
                category_canonical: "tops",
                product_types: ["blouse"],
            },
        };
        var compliance = (0, searchHitRelevance_1.scoreAudienceCompliance)(undefined, "men", hit);
        expect(compliance).toBeLessThan(0.4);
    });
});
