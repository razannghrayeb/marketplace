/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { extractProductTypesFromTitle } from "./searchDocument";

describe("extractProductTypesFromTitle - robust type normalization", () => {
  test("does not collapse shirt into tshirt", () => {
    const types = extractProductTypesFromTitle("Men Shirt Jacket");
    expect(types).toContain("shirt");
    expect(types).not.toContain("tshirt");
  });

  test("does not collapse blouse into tshirt", () => {
    const types = extractProductTypesFromTitle("Women Blouse");
    expect(types).toContain("blouse");
    expect(types).not.toContain("tshirt");
  });

  test("short sleeve phrase does not create shorts type", () => {
    const types = extractProductTypesFromTitle("Short Sleeve Top");
    expect(types).toContain("top");
    expect(types).not.toContain("shorts");
  });

  test("real shorts title still maps to shorts", () => {
    const types = extractProductTypesFromTitle("Cotton Shorts");
    expect(types).toContain("shorts");
  });

  test("multi-category sanity across families", () => {
    expect(extractProductTypesFromTitle("Leather Boots")).toContain("boots");
    expect(extractProductTypesFromTitle("Cargo Pants")).toContain("pants");
    expect(extractProductTypesFromTitle("Zip Hoodie")).toContain("hoodie");
  });
});
