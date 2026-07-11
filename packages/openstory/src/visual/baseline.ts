import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { classifyVisualDiff } from "./classify.js";
import { comparePng } from "./compare.js";
import { PIXELMATCH_COLOR_THRESHOLD } from "./constants.js";
import type { VisualComparison, VisualThresholds } from "./types.js";

export type VisualGateMode = "check" | "update";

export interface EvaluateShowcaseOptions {
  showcaseId: string;
  actual: Buffer;
  baselineDir: string;
  thresholds: VisualThresholds;
  mode: VisualGateMode;
  colorThreshold?: number;
}

const DIFF_DIR_NAME = "__diffs__";

export const baselinePathFor = (baselineDir: string, showcaseId: string): string =>
  join(baselineDir, `${showcaseId}.png`);

export const diffPathFor = (baselineDir: string, showcaseId: string): string =>
  join(baselineDir, DIFF_DIR_NAME, `${showcaseId}.png`);

const writeFileEnsuringDir = (filePath: string, contents: Buffer): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
};

export const evaluateShowcase = (options: EvaluateShowcaseOptions): VisualComparison => {
  const { showcaseId, actual, baselineDir, thresholds, mode } = options;
  const colorThreshold = options.colorThreshold ?? PIXELMATCH_COLOR_THRESHOLD;
  const baselinePath = baselinePathFor(baselineDir, showcaseId);
  const baselineExisted = existsSync(baselinePath);

  if (mode === "update") {
    writeFileEnsuringDir(baselinePath, actual);
    return {
      showcaseId,
      verdict: "pass",
      mismatchRatio: 0,
      mismatchedPixels: 0,
      totalPixels: 0,
      baselineExisted,
      resolvedBy: "baseline",
      baselinePath,
    };
  }

  if (!baselineExisted) {
    return {
      showcaseId,
      verdict: "fail",
      mismatchRatio: 1,
      mismatchedPixels: 0,
      totalPixels: 0,
      baselineExisted: false,
      resolvedBy: "baseline",
      reason: "no-baseline",
      baselinePath,
    };
  }

  const baseline = readFileSync(baselinePath);
  const comparison = comparePng(baseline, actual, colorThreshold);

  if (comparison.dimensionMismatch) {
    return {
      showcaseId,
      verdict: "fail",
      mismatchRatio: 1,
      mismatchedPixels: comparison.mismatchedPixels,
      totalPixels: comparison.totalPixels,
      baselineExisted: true,
      resolvedBy: "baseline",
      reason: "dimension-mismatch",
      baselinePath,
    };
  }

  const verdict = classifyVisualDiff({
    mismatchedPixels: comparison.mismatchedPixels,
    totalPixels: comparison.totalPixels,
    passRatio: thresholds.passRatio,
    unresolvedRatio: thresholds.unresolvedRatio,
  });

  const mismatchRatio =
    comparison.totalPixels > 0 ? comparison.mismatchedPixels / comparison.totalPixels : 1;

  let diffPath: string | undefined;
  if (verdict !== "pass") {
    diffPath = diffPathFor(baselineDir, showcaseId);
    writeFileEnsuringDir(diffPath, comparison.diff);
  }

  return {
    showcaseId,
    verdict,
    mismatchRatio,
    mismatchedPixels: comparison.mismatchedPixels,
    totalPixels: comparison.totalPixels,
    baselineExisted: true,
    resolvedBy: "baseline",
    reason: verdict === "fail" ? "hard-mismatch" : undefined,
    baselinePath,
    diffPath,
  };
};
