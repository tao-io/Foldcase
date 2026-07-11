import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { PIXELMATCH_COLOR_THRESHOLD } from "./constants.js";

export interface PngComparison {
  dimensionMismatch: boolean;
  mismatchedPixels: number;
  totalPixels: number;
  diff: Buffer;
  width: number;
  height: number;
}

export const comparePng = (
  baseline: Buffer,
  actual: Buffer,
  colorThreshold: number = PIXELMATCH_COLOR_THRESHOLD,
): PngComparison => {
  const baselinePng = PNG.sync.read(baseline);
  const actualPng = PNG.sync.read(actual);

  const dimensionMismatch =
    baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height;

  if (dimensionMismatch) {
    return {
      dimensionMismatch: true,
      mismatchedPixels: baselinePng.width * baselinePng.height,
      totalPixels: baselinePng.width * baselinePng.height,
      diff: Buffer.alloc(0),
      width: baselinePng.width,
      height: baselinePng.height,
    };
  }

  const { width, height } = baselinePng;
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(baselinePng.data, actualPng.data, diff.data, width, height, {
    threshold: colorThreshold,
  });

  return {
    dimensionMismatch: false,
    mismatchedPixels,
    totalPixels: width * height,
    diff: PNG.sync.write(diff),
    width,
    height,
  };
};
