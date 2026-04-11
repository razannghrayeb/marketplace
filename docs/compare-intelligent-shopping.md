# Intelligent Fashion Compare (2026 Upgrade)

This document describes the upgraded compare system behind POST /api/compare.

## Why This Upgrade

Traditional product compare often gives low-value output (for example forcing a winner between unrelated categories).
The upgraded system is customer-goal-driven and context-aware.

## What Is New

1. Goal-based comparison
- compare_goal input controls ranking strategy.
- Supported values:
  - best_value
  - premium_quality
  - style_match
  - low_risk_return
  - occasion_fit

2. Occasion-aware ranking
- Optional occasion input:
  - casual, work, formal, party, travel
- Occasion signal influences winner when compare_goal=occasion_fit.

3. Smart mode switching
- comparison_mode in response is one of:
  - direct_head_to_head: same type, normal winner selection
  - scenario_compare: same major type, but subtype differences (for example sneaker vs heel)
  - outfit_compare: mixed category selection (no fake direct winner)

4. Multi-winner output
- winners_by_goal returns winners for:
  - overall
  - value
  - quality
  - style
  - risk
  - occasion

5. Risk and timing intelligence
- risk_summary per product + overall risk level.
- timing_insight recommendation:
  - buy_now
  - wait
  - monitor

6. Explainability and alternatives
- evidence: measurable reasoning bullets.
- alternatives:
  - better_cheaper_product_id
  - better_quality_product_id
  - similar_style_safer_product_id

7. Cross-category outfit impact
- In outfit_compare mode, response includes:
  - outfit_winner_product_id
  - versatility_scores
  - gap_fill_scores

## API Contract

Request body (minimum):

{
  "product_ids": [101, 205, 309]
}

Request body (intelligent mode):

{
  "product_ids": [101, 205, 309],
  "compare_goal": "best_value",
  "occasion": "work"
}

Response additions:
- comparison_context.requested_goal
- comparison_context.requested_occasion
- winners_by_goal
- evidence
- alternatives
- risk_summary
- timing_insight
- outfit_impact (when mode=outfit_compare)

Optional pagination (list-style compare endpoints):
- `GET /api/compare/tooltips?paginate=true&page=1&limit=20`
- `POST /api/compare/reviews?paginate=true&page=1&limit=20`

Pagination response shape when enabled:
- `pagination.page`
- `pagination.limit`
- `pagination.total`
- `pagination.total_pages`
- `pagination.has_next`
- `pagination.has_prev`

Note:
- `POST /api/compare` itself does not need pagination because input is capped to 2-5 products and output is intentionally bounded.

## Engineering Notes

Scoring strategy is deterministic and derived from existing compare signals.
No random scoring is used in the intelligent compare decision path.

High-level scoring profiles:
- Value: price safety + policy + image trust + text completeness
- Quality: text depth + image quality + policy + price sanity
- Style: fit/fabric/color consistency + image quality
- Risk: inverse of risk card score
- Occasion: overall quality blended with occasion keyword relevance

## Frontend Integration

Compare page now supports:
- Goal selector
- Occasion selector
- Goal winners panel
- Risk and timing panel
- Alternatives panel
- Outfit impact panel (cross-category)
- Evidence panel

## Migration and Compatibility

Backward compatibility is preserved:
- Existing fields (verdict, product_summaries, comparison_details, product_map) remain available.
- New fields are additive.

## Validation Rules

- product_ids: 2 to 5 positive integers
- compare_goal: optional, must be in supported list
- occasion: optional, must be in supported list

## Recommended Usage Patterns

1. If users select same category items:
- Use direct_head_to_head or scenario_compare output.

2. If users select mixed categories:
- Use outfit_compare output.
- Highlight winners_by_goal and outfit_impact instead of a single winner.

3. For conversion optimization:
- Surface timing_insight + risk_summary near CTA buttons.
- Show alternatives for users who hesitate.
