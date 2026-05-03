/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { normalizeHydratedProduct } from "./productNormalization";

describe("normalizeHydratedProduct", () => {
  test("normalizes sweater and turtleneck metadata from title", () => {
    const pullover = normalizeHydratedProduct({ title: "Grey Knitwear Pullover" });
    expect(pullover.normalizedFamily).toBe("tops");
    expect(pullover.normalizedType).toBe("sweater");
    expect(pullover.normalizedSubtype).toBe("knit_pullover");

    const turtleneck = normalizeHydratedProduct({ title: "Turtleneck Dark Grey Cotton Pullover" });
    expect(turtleneck.normalizedFamily).toBe("tops");
    expect(turtleneck.normalizedType).toBe("sweater");
    expect(turtleneck.normalizedSubtype).toBe("turtleneck");
  });

  test("normalizes dresses, trousers, and bags without description poisoning", () => {
    const dress = normalizeHydratedProduct({ title: "Organic Cotton Waffle Tank Dress" });
    expect(dress.normalizedFamily).toBe("dresses");
    expect(dress.normalizedType).toBe("dress");
    expect(dress.normalizedSubtype).toBe("tank_dress");
    expect(dress.normalizedColor).toBe(null);

    const trouser = normalizeHydratedProduct({ title: "Wide Leg Trouser" });
    expect(trouser.normalizedFamily).toBe("bottoms");
    expect(trouser.normalizedType).toBe("trousers");
    expect(trouser.normalizedSubtype).toBe("wide_leg_trouser");

    const backpack = normalizeHydratedProduct({ title: "Backpack" });
    expect(backpack.normalizedFamily).toBe("bags");
    expect(backpack.normalizedType).toBe("bag");
    expect(backpack.normalizedSubtype).toBe("backpack");
  });

  test("does not infer color from category text", () => {
    const normalized = normalizeHydratedProduct({
      title: "Classic Shirt",
      category: "White Shirts",
    });

    expect(normalized.normalizedColor).toBe(null);
  });

  test("normalizes real catalog category labels", () => {
    expect(normalizeHydratedProduct({ category: "women pullover" }).normalizedType).toBe("sweater");
    expect(normalizeHydratedProduct({ category: "Dress Shoes" }).normalizedFamily).toBe("footwear");
    expect(normalizeHydratedProduct({ category: "BALLERINAS" }).normalizedType).toBe("flat");
    expect(normalizeHydratedProduct({ category: "CROSSBODY BAGS" }).normalizedFamily).toBe("bags");
    expect(normalizeHydratedProduct({ category: "TRACKSUITS & TRACK TROUSERS" }).normalizedFamily).toBe("bottoms");
    expect(normalizeHydratedProduct({ category: "COATS & JACKETS" }).normalizedFamily).toBe("outerwear");
    expect(normalizeHydratedProduct({ category: "ABAYAS" }).normalizedFamily).toBe("dresses");
  });
});
