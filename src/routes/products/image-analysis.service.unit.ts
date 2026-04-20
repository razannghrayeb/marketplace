/* Minimal declarations for test globals to satisfy static checks */
declare const describe: any;
declare const test: any;
declare const expect: any;

import { inferFootwearSubtypeFromCaption } from "./image-analysis.service";

describe("inferFootwearSubtypeFromCaption", () => {
  test("keeps explicit heel cues as heels", () => {
    expect(inferFootwearSubtypeFromCaption("shoe", "woman wearing heels")).toBe("heels");
  });

  test("maps formal shoe captions to formal dress shoes", () => {
    expect(inferFootwearSubtypeFromCaption("shoe", "man in a formal suit with dress shoes")).toBe("oxfords");
  });

  test("keeps sneaker cues as sneakers", () => {
    expect(inferFootwearSubtypeFromCaption("shoe", "running sneakers")).toBe("sneakers");
  });
});
