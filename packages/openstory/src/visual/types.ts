export type VisualVerdict = "pass" | "unresolved" | "fail";

export type VisualResolvedBy = "baseline" | "llm-judge";

export type VisualFailReason =
  | "no-baseline"
  | "dimension-mismatch"
  | "render-error"
  | "hard-mismatch";

export interface VisualThresholds {
  passRatio: number;
  unresolvedRatio: number;
}

export interface VisualDiffInput extends VisualThresholds {
  mismatchedPixels: number;
  totalPixels: number;
}

export interface VisualComparison {
  showcaseId: string;
  verdict: VisualVerdict;
  mismatchRatio: number;
  mismatchedPixels: number;
  totalPixels: number;
  baselineExisted: boolean;
  resolvedBy: VisualResolvedBy;
  reason?: VisualFailReason;
  baselinePath?: string;
  diffPath?: string;
}

export interface VisualReport {
  comparisons: VisualComparison[];
  counts: Record<VisualVerdict, number>;
  verdict: VisualVerdict;
}
