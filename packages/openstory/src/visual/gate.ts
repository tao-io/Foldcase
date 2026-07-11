import { evaluateShowcase, type VisualGateMode } from "./baseline.js";
import { DEFAULT_PASS_RATIO, DEFAULT_UNRESOLVED_RATIO } from "./constants.js";
import { applyJudge } from "./judge.js";
import { buildReport } from "./report.js";
import type { VisualComparison, VisualJudge, VisualReport, VisualThresholds } from "./types.js";

export interface VisualGateOptions {
  showcaseIds: ReadonlyArray<string>;
  capture: (showcaseId: string) => Promise<Buffer>;
  baselineDir: string;
  mode: VisualGateMode;
  thresholds?: VisualThresholds;
  colorThreshold?: number;
  judge?: VisualJudge;
}

const DEFAULT_THRESHOLDS: VisualThresholds = {
  passRatio: DEFAULT_PASS_RATIO,
  unresolvedRatio: DEFAULT_UNRESOLVED_RATIO,
};

const renderErrorComparison = (showcaseId: string): VisualComparison => ({
  showcaseId,
  verdict: "fail",
  mismatchRatio: 1,
  mismatchedPixels: 0,
  totalPixels: 0,
  baselineExisted: false,
  resolvedBy: "baseline",
  reason: "render-error",
});

export const runVisualGate = async (options: VisualGateOptions): Promise<VisualReport> => {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  const captured = await Promise.all(
    options.showcaseIds.map(async (showcaseId): Promise<VisualComparison> => {
      try {
        const actual = await options.capture(showcaseId);
        return evaluateShowcase({
          showcaseId,
          actual,
          baselineDir: options.baselineDir,
          thresholds,
          mode: options.mode,
          colorThreshold: options.colorThreshold,
        });
      } catch {
        return renderErrorComparison(showcaseId);
      }
    }),
  );

  const resolved = await applyJudge(captured, options.judge);
  return buildReport(resolved);
};
