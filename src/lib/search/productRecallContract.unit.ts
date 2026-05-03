/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { allocateRecallBudgets, buildProductRecallContract } from "./productRecallContract";

describe("buildProductRecallContract", () => {
  test("does not promote noisy desired bottom terms into exact trouser matches", () => {
    const contract = buildProductRecallContract({
      desiredProductTypes: ["trousers", "jeans", "cargo pants"],
      detectionCategory: "bottoms",
    });

    expect(contract.exactTypes).toContain("trousers");
    expect(contract.exactTypes).not.toContain("jeans");
    expect(contract.exactTypes).not.toContain("cargo pants");
    expect(contract.weakTypes).toContain("jeans");
    expect(contract.weakTypes).toContain("cargo pants");
  });

  test("keeps dress exact terms separate from bad top terms", () => {
    const contract = buildProductRecallContract({
      desiredProductTypes: ["dress", "tank top", "cami"],
      detectionCategory: "dresses",
    });

    expect(contract.exactTypes).toContain("dress");
    expect(contract.exactTypes).toContain("tank dress");
    expect(contract.exactTypes).not.toContain("tank top");
    expect(contract.exactTypes).not.toContain("cami");
    expect(contract.badTypes).toContain("tank top");
  });

  test("uses visual-first recall budgets", () => {
    const budgets = allocateRecallBudgets(100);

    expect(budgets.visual).toBe(60);
    expect(budgets.exact).toBe(25);
    expect(budgets.related).toBe(15);
  });
});
