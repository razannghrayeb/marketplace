export function completeStyleCategoryLabel(raw?: string): string {
  const c = String(raw || "").toLowerCase().trim();
  if (!c) return "Recommended";
  if (c.includes("pyjama") || c.includes("pajama") || c.includes("sleepwear") || c.includes("nightwear") || c.includes("loungewear")) return "";
  if (c.includes("footwear") || c.includes("shoe") || c.includes("sneaker") || c.includes("boot") || c.includes("sandal") || c.includes("loafer") || c.includes("heel") || c.includes("flat") || c.includes("mule") || c.includes("trainer")) return "Shoes";
  if (c.includes("bag") || c.includes("backpack") || c.includes("crossbody") || c.includes("clutch") || c.includes("tote")) return "Bags";
  if (c.includes("bottom") || c.includes("pants") || c.includes("trouser") || c.includes("jeans") || c.includes("skirt") || c.includes("short")) return "Bottoms";
  if (c.includes("dress")) return "Dresses";
  if (c.includes("outerwear") || c.includes("jacket") || c.includes("coat") || c.includes("blazer")) return "Outerwear";
  if (c.includes("top") || c.includes("shirt") || c.includes("blouse") || c.includes("polo") || c.includes("hoodie") || c.includes("sweater")) return "Tops";
  if (c.includes("wallet") || c.includes("accessor") || c.includes("watch") || c.includes("scarf") || c.includes("hat") || c.includes("belt") || c.includes("jewel") || c.includes("jewelry") || c.includes("sunglass")) return "Accessories";
  if (c === "recommended") return "Accessories";
  return c.charAt(0).toUpperCase() + c.slice(1);
}
