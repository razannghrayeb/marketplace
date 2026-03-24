/**
 * Canonical OpenSearch kNN field names for the retrieval platform.
 *
 * Use OPENSEARCH_GLOBAL_EMBEDDING_FIELD=embedding_global after backfilling that field;
 * default remains `embedding` for existing indexes.
 */

const raw = String(process.env.OPENSEARCH_GLOBAL_EMBEDDING_FIELD ?? "").trim();
/** Active OS field for semantic "global" kNN (legacy: embedding). */
export const OPENSEARCH_GLOBAL_EMBEDDING_FIELD = raw || "embedding";

/** Preferred future field name (document / migration target). */
export const OPENSEARCH_GLOBAL_EMBEDDING_FIELD_CANONICAL = "embedding_global";

export function opensearchFieldForSemanticAttribute(
  attribute: import("./multiVectorSearch").SemanticAttribute,
): string {
  if (attribute === "global") return OPENSEARCH_GLOBAL_EMBEDDING_FIELD;
  const map: Record<string, string> = {
    color: "embedding_color",
    texture: "embedding_texture",
    material: "embedding_material",
    style: "embedding_style",
    pattern: "embedding_pattern",
  };
  return map[attribute] ?? OPENSEARCH_GLOBAL_EMBEDDING_FIELD;
}
