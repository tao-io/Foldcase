import type { VisualDiffInput, VisualVerdict } from "./types.js";

export const classifyVisualDiff = (input: VisualDiffInput): VisualVerdict => {
  const { mismatchedPixels, totalPixels, passRatio, unresolvedRatio } = input;
  if (totalPixels <= 0) return "fail";

  const ratio = mismatchedPixels / totalPixels;
  if (ratio <= passRatio) return "pass";
  if (ratio <= unresolvedRatio) return "unresolved";
  return "fail";
};
