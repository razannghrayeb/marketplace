export type SuitCatalogCueExplanation = {
  matched: boolean;
  reasons: string[];
  normalizedText: string;
};

function normalizeCatalogText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/]/g, " ")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productBlob(src: Record<string, unknown>): string {
  return [
    src.title,
    src.description,
    src.category,
    src.category_canonical,
    src.brand,
    Array.isArray(src.product_types) ? src.product_types.join(" ") : src.product_types,
  ]
    .filter((x) => x != null)
    .map((x) => String(x))
    .join(" ");
}

const NON_TAILORED_SUIT_CONTEXT_RE =
  /\b(track\s*suits?|tracksuits?|sweat\s*suits?|sweatsuits?|training\s+suits?|workout\s+suits?|running\s+suits?|warm\s*up\s+suits?|ski\s+suits?|snow\s*suits?|snowsuits?|swim\s*suits?|swimsuits?|bathing\s+suits?|wet\s*suits?|wetsuits?|body\s*suits?|bodysuits?|jump\s*suits?|jumpsuits?|play\s*suits?|playsuits?|rompers?|unitards?|leotards?|suit\s+(?:covers?|bags?|carriers?))\b/;

const NON_TAILORED_CATEGORY_RE =
  /\b(activewear|sportswear|sport\s*wear|training|workout|running|swimwear|beachwear|underwear|lingerie|one\s*piece|jumpsuits?|playsuits?|rompers?)\b/;

function nonTailoredSuitReason(norm: string, src: Record<string, unknown>): string | null {
  if (NON_TAILORED_SUIT_CONTEXT_RE.test(norm)) return "non_tailored_suit_phrase";

  const categoryBlob = normalizeCatalogText([
    src.category,
    src.category_canonical,
    Array.isArray(src.product_types) ? src.product_types.join(" ") : src.product_types,
  ].filter((x) => x != null).join(" "));
  if (/\bsuits?\b/.test(norm) && NON_TAILORED_CATEGORY_RE.test(categoryBlob)) {
    return "non_tailored_suit_category";
  }

  return null;
}

export function explainActualSuitCatalogCue(src: Record<string, unknown>): SuitCatalogCueExplanation {
  const norm = normalizeCatalogText(productBlob(src));
  if (!norm) return { matched: false, reasons: ["empty_normalized_blob"], normalizedText: "" };

  const nonTailoredReason = nonTailoredSuitReason(norm, src);
  if (nonTailoredReason) {
    return { matched: false, reasons: [nonTailoredReason], normalizedText: norm };
  }

  const reasons: string[] = [];

  if (/\btuxedos?\b/.test(norm)) {
    reasons.push("explicit_tuxedo_token");
    return { matched: true, reasons, normalizedText: norm };
  }

  if (/\b(?:two|three|2|3)[-\s]*piece\s+suits?\b|\bmatching\s+suits?\b|\bsuiting\b/.test(norm)) {
    reasons.push("full_suit_phrase");
    return { matched: true, reasons, normalizedText: norm };
  }

  const withoutSuitJacket = norm.replace(/\bsuit\s+jackets?\b/g, " ").replace(/\s+/g, " ").trim();
  if (/\bsuits?\b/.test(withoutSuitJacket)) {
    reasons.push("explicit_suit_token");
    return { matched: true, reasons, normalizedText: norm };
  }
  if (/\bsuit\s+jackets?\b/.test(norm)) {
    reasons.push("suit_jacket_only");
  }

  const hasBlazer = /\b(blazer|blazers|suit jacket|suit jackets|dress jacket|dress jackets|sport coat|sportcoat)\b/.test(norm);
  const hasSuitBottomHint = /\b(pant|pants|trouser|trousers|slacks|dress pants|2p|2\s*piece|3p|3\s*piece|set|full set)\b/.test(norm);
  if (hasBlazer && hasSuitBottomHint) {
    reasons.push("blazer_plus_bottom_hint");
    return { matched: true, reasons, normalizedText: norm };
  }

  const catRaw = normalizeCatalogText(src.category);
  if (/\b(suits?|tuxedos?)\b/.test(catRaw)) {
    reasons.push("suit_category");
    return { matched: true, reasons, normalizedText: norm };
  }

  return { matched: false, reasons: reasons.length > 0 ? reasons : ["no_suit_cue_match"], normalizedText: norm };
}

export function hasActualSuitCatalogCue(src: Record<string, unknown>): boolean {
  return explainActualSuitCatalogCue(src).matched;
}
