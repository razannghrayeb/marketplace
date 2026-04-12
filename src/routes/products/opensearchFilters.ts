/**
 * Shared OpenSearch filter fragments for product discovery
 */

/** attr_gender in the index may be "male", "men", "female", "women", etc. */
export function attrGenderFilterClause(gender: string): { terms: { attr_gender: string[] } } {
  const g = gender.trim().toLowerCase();
  const men = ["men", "man", "male", "mens", "men's", "gents", "gentlemen", "boy", "boys", "boys-kids", "boys_kids"];
  const women = ["women", "woman", "female", "womens", "women's", "ladies", "lady", "girl", "girls", "girls-kids", "girls_kids"];
  const variants =
    g === "men" || g === "man" || g === "male" || g === "boy" || g === "boys" || g === "boys-kids" || g === "boys_kids"
      ? men
      : g === "women" || g === "woman" || g === "female" || g === "girl" || g === "girls" || g === "girls-kids" || g === "girls_kids"
        ? women
        : [g];
  return { terms: { attr_gender: variants } };
}
