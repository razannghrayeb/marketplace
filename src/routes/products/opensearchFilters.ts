/**
 * Shared OpenSearch filter fragments for product discovery
 */

/** attr_gender in the index may be "male", "men", "female", "women", etc. */
export function attrGenderFilterClause(gender: string): { terms: { attr_gender: string[] } } {
  const g = gender.trim().toLowerCase();
  const men = ["men", "man", "male", "mens", "men's", "gents", "gentlemen"];
  const women = ["women", "woman", "female", "womens", "women's", "ladies", "lady"];
  const variants =
    g === "men" || g === "man" || g === "male"
      ? men
      : g === "women" || g === "woman" || g === "female"
        ? women
        : [g];
  return { terms: { attr_gender: variants } };
}
