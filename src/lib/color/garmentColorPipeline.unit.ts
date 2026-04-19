import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { extractGarmentFashionColors } from "./garmentColorPipeline";

async function solidPng(r: number, g: number, b: number, w = 96, h = 96): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
}

async function splitVerticalPng(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
  w = 96,
  h = 96,
): Promise<Buffer> {
  const leftBuf = await solidPng(left.r, left.g, left.b, Math.floor(w / 2), h);
  const rightBuf = await solidPng(right.r, right.g, right.b, w - Math.floor(w / 2), h);
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: leftBuf, left: 0, top: 0 },
      { input: rightBuf, left: Math.floor(w / 2), top: 0 },
    ])
    .png()
    .toBuffer();
}

describe("garmentColorPipeline", () => {
  it("keeps saturated yellow as yellow (not beige/off-white)", async () => {
    const img = await solidPng(246, 220, 52);
    const out = await extractGarmentFashionColors(img, { minShare: 0.08 });
    assert.equal(out.primaryCanonical, "yellow");
  });

  it("maps baby-blue to light-blue (not white/off-white)", async () => {
    const img = await solidPng(170, 205, 240);
    const out = await extractGarmentFashionColors(img, { minShare: 0.08 });
    assert.equal(out.primaryCanonical, "light-blue");
  });

  it("returns swapped promoted neutral as primary when black is only marginally stronger", async () => {
    const img = await splitVerticalPng(
      { r: 18, g: 18, b: 20 },
      { r: 145, g: 145, b: 148 },
    );
    const out = await extractGarmentFashionColors(img, { minShare: 0.08 });

    assert.equal(out.paletteCanonical[0], "gray");
    assert.equal(out.primaryCanonical, "gray");
  });
});
