/**
 * Types for DB-backed taxonomy (Phase 2+). Phase 1 uses `productTypeTaxonomy.ts` in code.
 */

export interface CanonicalProductTypeRow {
  id: string;
  slug: string;
  display_name: string;
  parent_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductTypeAliasRow {
  id: number;
  canonical_id: string;
  alias: string;
  locale: string | null;
  source: "manual" | "mined" | "vendor" | "ml";
  weight: number;
}

export type TaxonomyEdgeKind = "parent" | "related" | "sibling_cluster";

export interface ProductTypeEdgeRow {
  id: number;
  from_id: string;
  to_id: string;
  kind: TaxonomyEdgeKind;
  weight: number;
}

export interface ProductSearchEnrichmentRow {
  product_id: bigint;
  canonical_type_ids: string[];
  raw_category: string | null;
  raw_brand: string | null;
  norm_confidence: number;
  category_confidence: number;
  brand_confidence: number;
  attribute_json: Record<string, unknown>;
  classifier_version: string | null;
  updated_at: Date;
}
