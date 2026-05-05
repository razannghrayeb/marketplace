/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { assignMatchTier } from "./matchTierAssignment";

describe("assignMatchTier", () => {
  test("tshirt_or_shirt intent treats tshirt as an exact top alias", () => {
    const result = assignMatchTier(
      "exact",
      {
        normalizedFamily: "tops",
        normalizedType: "tshirt",
        normalizedSubtype: "short_sleeve_top",
        normalizedColor: "white",
        normalizedAudience: "men",
      },
      {
        imageMode: "worn_outfit",
        family: "tops",
        type: "tshirt_or_shirt",
        subtype: "short_sleeve_top",
        color: "white",
        audience: "men",
        confidence: {
          family: 1,
          type: 1,
          color: 1,
          audience: 1,
          style: 0,
          material: 0,
        },
      } as any,
    );

    expect(result.tier).toBe("exact");
    expect(result.reason).toContain("type match (tshirt)");
  });
});