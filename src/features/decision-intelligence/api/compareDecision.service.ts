import { pg } from "../../../lib/core";
import type {
  CompareDecisionRequest,
  CompareDecisionServiceResponse,
  DecisionEventPublisher,
  RawProduct,
} from "../types";
import { CompareDecisionRequestSchema } from "./schemas";
import { runCompareDecisionEngine } from "../engine/compareEngine";
import { validateComparableProductSet } from "./comparability";

class ConsoleDecisionPublisher implements DecisionEventPublisher {
  publish(event: { name: string; payload: Record<string, unknown> }): void {
    // Keep publisher lightweight and pluggable.
    console.log(`[decision-intelligence] ${event.name}`, event.payload);
  }
}

function parseOptionalArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parseOptionalArray(parsed);
      } catch {
        return trimmed.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      }
    }
    return trimmed.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function inferMaterial(description: string | null | undefined): string[] {
  const text = (description || "").toLowerCase();
  const candidates = ["cotton", "linen", "wool", "silk", "satin", "leather", "denim", "polyester"];
  return candidates.filter((c) => text.includes(c));
}

function inferFit(description: string | null | undefined): string | undefined {
  const text = (description || "").toLowerCase();
  const fits = ["slim", "tailored", "oversized", "relaxed", "regular", "boxy"];
  return fits.find((f) => text.includes(f));
}

function inferStyleTags(description: string | null | undefined, category: string | null | undefined): string[] {
  const text = `${description || ""} ${category || ""}`.toLowerCase();
  const tags = [
    "minimal",
    "classic",
    "trendy",
    "polished",
    "relaxed",
    "edgy",
    "expressive",
    "feminine",
  ];
  return tags.filter((t) => text.includes(t));
}

async function loadProducts(productIds: number[]): Promise<RawProduct[]> {
  const result = await pg.query(
    `SELECT id,
            title,
            COALESCE(brand, '') AS brand,
            COALESCE(category, 'other') AS category,
            description,
            color,
            currency,
            price_cents,
            sales_price_cents,
            image_url,
            image_urls,
            image_cdn,
            return_policy
     FROM products
     WHERE id = ANY($1)`,
    [productIds]
  );

  return result.rows.map((row) => {
    const imageUrlsFromArray = parseOptionalArray(row.image_urls);
    const imageUrls = [
      ...imageUrlsFromArray,
      row.image_cdn ? String(row.image_cdn) : "",
      row.image_url ? String(row.image_url) : "",
    ].filter(Boolean);

    const price = Number(row.price_cents || 0) / 100;
    const salePrice = row.sales_price_cents ? Number(row.sales_price_cents) / 100 : undefined;

    return {
      id: Number(row.id),
      title: String(row.title || "Untitled product"),
      brand: String(row.brand || "Unknown"),
      category: String(row.category || "other"),
      subcategory: undefined,
      price,
      salePrice,
      colors: parseOptionalArray(row.color),
      material: inferMaterial(row.description),
      fit: inferFit(row.description),
      styleTags: inferStyleTags(row.description, row.category),
      occasionTags: [],
      careTags: parseOptionalArray(row.return_policy),
      description: row.description ? String(row.description) : undefined,
      imageUrls,
      reviewSummary: undefined,
      metadata: {},
    } satisfies RawProduct;
  });
}

function toInvalidRequest(errorMessage: string): CompareDecisionServiceResponse {
  return {
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message: errorMessage,
    },
  };
}

export async function compareProductsWithDecisionIntelligence(
  rawInput: unknown,
  publisher: DecisionEventPublisher = new ConsoleDecisionPublisher()
): Promise<CompareDecisionServiceResponse> {
  const parsed = CompareDecisionRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return toInvalidRequest(reason || "Invalid compare request.");
  }

  const request: CompareDecisionRequest = parsed.data;

  const products = await loadProducts(request.productIds);
  const found = new Set(products.map((p) => p.id));
  const missing = request.productIds.filter((id) => !found.has(id));

  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: "PRODUCTS_NOT_FOUND",
        message: "Some products were not found.",
        details: { missingProductIds: missing },
      },
    };
  }

  if (products.length < 2) {
    return {
      ok: false,
      error: {
        code: "INSUFFICIENT_PRODUCT_DATA",
        message: "At least 2 products are required after normalization.",
      },
    };
  }

  const comparability = validateComparableProductSet(products);
  if (!comparability.valid) {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message:
          "Compare supports fashion-like products only. Remove unrelated items (for example beauty/home/electronics) and retry.",
        details: { nonComparableProductIds: comparability.nonFashionProductIds },
      },
    };
  }

  const response = runCompareDecisionEngine(products, request, {
    publisher,
    version: "2026.04.05",
  });

  return { ok: true, response };
}
