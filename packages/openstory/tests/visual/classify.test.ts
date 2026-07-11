import { describe, expect, it } from "vitest";

import { classifyVisualDiff } from "../../src/visual/classify.js";

describe("classifyVisualDiff — the three-state verdict", () => {
  const thresholds = { passRatio: 0.001, unresolvedRatio: 0.05 };

  it("returns pass when the mismatch ratio is at or below the pass threshold", () => {
    expect(classifyVisualDiff({ mismatchedPixels: 0, totalPixels: 10_000, ...thresholds })).toBe(
      "pass",
    );
    expect(classifyVisualDiff({ mismatchedPixels: 10, totalPixels: 10_000, ...thresholds })).toBe(
      "pass",
    );
  });

  it("returns unresolved when the mismatch is in the ambiguous band", () => {
    expect(classifyVisualDiff({ mismatchedPixels: 50, totalPixels: 10_000, ...thresholds })).toBe(
      "unresolved",
    );
    expect(classifyVisualDiff({ mismatchedPixels: 500, totalPixels: 10_000, ...thresholds })).toBe(
      "unresolved",
    );
  });

  it("returns fail when the mismatch exceeds the unresolved threshold", () => {
    expect(classifyVisualDiff({ mismatchedPixels: 501, totalPixels: 10_000, ...thresholds })).toBe(
      "fail",
    );
    expect(
      classifyVisualDiff({ mismatchedPixels: 10_000, totalPixels: 10_000, ...thresholds }),
    ).toBe("fail");
  });

  it("treats a zero-pixel image as fail (no meaningful comparison)", () => {
    expect(classifyVisualDiff({ mismatchedPixels: 0, totalPixels: 0, ...thresholds })).toBe("fail");
  });
});
