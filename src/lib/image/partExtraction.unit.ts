import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { extractAllApplicablePartCrops } from "./partCropping";
import { getAllPartTypes, getApplicablePartTypesForLabel, PartType } from "./partExtraction";

test("generic query label enables every part type", () => {
  assert.deepEqual(
    new Set(getApplicablePartTypesForLabel("generic")),
    new Set(getAllPartTypes()),
  );
});

test("generic query crop extraction returns all valid large-image part crops", async () => {
  const image = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: { r: 120, g: 80, b: 180 },
    },
  })
    .png()
    .toBuffer();

  const crops = await extractAllApplicablePartCrops(image, "generic");

  assert.equal(crops.size, getAllPartTypes().length);
  for (const partType of getAllPartTypes()) {
    assert.ok(crops.has(partType), `missing crop entry for ${partType}`);
    assert.ok(crops.get(partType), `expected valid crop for ${partType}`);
  }
});

test("specific labels still only extract applicable parts", () => {
  const shoeParts = getApplicablePartTypesForLabel("sneaker");
  assert.ok(shoeParts.includes(PartType.Toe));
  assert.ok(!shoeParts.includes(PartType.Sleeve));
});
