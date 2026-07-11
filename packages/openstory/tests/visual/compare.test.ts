import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import { comparePng } from "../../src/visual/compare.js";

const solidPng = (
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Buffer => {
  const png = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    png.data[index * 4] = rgba[0];
    png.data[index * 4 + 1] = rgba[1];
    png.data[index * 4 + 2] = rgba[2];
    png.data[index * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
};

describe("comparePng — pixel diff over PNG buffers", () => {
  it("reports zero mismatch for identical images", () => {
    const white = solidPng(10, 10, [255, 255, 255, 255]);
    const result = comparePng(white, white);
    expect(result.dimensionMismatch).toBe(false);
    expect(result.mismatchedPixels).toBe(0);
    expect(result.totalPixels).toBe(100);
  });

  it("counts differing pixels between two images of equal size", () => {
    const white = solidPng(10, 10, [255, 255, 255, 255]);
    const black = solidPng(10, 10, [0, 0, 0, 255]);
    const result = comparePng(white, black);
    expect(result.dimensionMismatch).toBe(false);
    expect(result.mismatchedPixels).toBe(100);
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it("flags a dimension mismatch instead of throwing", () => {
    const small = solidPng(4, 4, [255, 255, 255, 255]);
    const large = solidPng(8, 8, [255, 255, 255, 255]);
    const result = comparePng(small, large);
    expect(result.dimensionMismatch).toBe(true);
    expect(result.totalPixels).toBeGreaterThan(0);
  });
});
