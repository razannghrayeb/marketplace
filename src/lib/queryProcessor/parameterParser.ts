/**
 * Parameter Parser
 *
 * Strips control parameters (limit, page, sort, etc.) from raw query text
 * before it enters the search pipeline. These must not be treated as
 * search terms.
 */

export interface ParsedParams {
  /** Query text suitable for processQuery / BM25 / vector search */
  searchText: string;
  /** Extracted control params (caller can merge with req.query) */
  controlParams: Record<string, string | number>;
}

/** Keys we recognize as control params when found as key=value in query text */
const CONTROL_KEYS = [
  "limit",
  "page",
  "sort",
  "offset",
  "per_page",
  "size",
  "perPage",
] as const;

/** For space-separated patterns, exclude "size" (ambiguous: "size 10" = product filter vs control) */
const SPACE_PARAM_KEYS = ["limit", "page", "sort", "offset", "per_page", "perPage"] as const;

/** Regex to match key=value (with optional spaces around =) */
const KEY_EQ_VALUE = new RegExp(
  `(?:^|\\s)(?:${CONTROL_KEYS.join("|")})\\s*=\\s*([^\\s]+)`,
  "gi"
);

/** Regex for space-separated param-like fragments: "limit 10000", "page 2", "sort price" */
const KEY_SPACE_VALUE = new RegExp(
  `(?:^|\\s)(?:${SPACE_PARAM_KEYS.join("|")})\\s+(\\d+|price|price_asc|price_desc|relevance|newest)(?=\\s|$)`,
  "gi"
);

function parseNumeric(value: string): string | number {
  const n = Number(value);
  if (Number.isFinite(n) && String(n) === value.trim()) return n;
  return value;
}

function addParam(
  params: Record<string, string | number>,
  key: string,
  value: string
): void {
  const k = key.toLowerCase();
  if (k === "limit" || k === "per_page" || k === "perpage") {
    params.limit = parseNumeric(value) as number;
  } else if (k === "page" || k === "offset") {
    params[k] = parseNumeric(value) as number;
  } else if (k === "sort") {
    params.sort = value.toLowerCase();
  } else if (k === "size") {
    params.size = value;
  }
}

/**
 * Parse raw query: strip control params, return clean search text + extracted params.
 */
export function parseParameters(raw: string): ParsedParams {
  let text = raw.trim();
  const controlParams: Record<string, string | number> = {};

  // 1. Strip key=value
  text = text.replace(KEY_EQ_VALUE, (match, value) => {
    const keyMatch = match.match(
      new RegExp(`(${CONTROL_KEYS.join("|")})`, "i")
    );
    if (keyMatch) {
      addParam(controlParams, keyMatch[1], value.trim());
    }
    return " ";
  });

  // 2. Strip key value (space-separated, when value is numeric or known sort)
  text = text.replace(KEY_SPACE_VALUE, (match, value) => {
    const keyMatch = match.match(
      new RegExp(`(${SPACE_PARAM_KEYS.join("|")})`, "i")
    );
    if (keyMatch) {
      addParam(controlParams, keyMatch[1], value.trim());
    }
    return " ";
  });

  // Collapse multiple spaces and trim
  text = text.replace(/\s+/g, " ").trim();

  return { searchText: text, controlParams };
}
