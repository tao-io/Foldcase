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

/**
 * The seam for an optional LLM-judge that resolves an "unresolved" (ambiguous)
 * visual diff into a decision. Implement `resolve` to inspect the baseline/actual/diff
 * images (e.g. hand them to a vision model) and return "pass" or "fail"; return
 * "unresolved" to abstain and leave the diff for a human. No judge is wired by default —
 * see `applyJudge` in `judge.ts`. This keeps the gate deterministic while leaving a
 * clean, documented place to plug AI review in later without changing the core.
 */
export interface VisualJudge {
  resolve: (request: VisualJudgeRequest) => Promise<VisualVerdict>;
}

export interface VisualJudgeRequest {
  showcaseId: string;
  mismatchRatio: number;
  baseline?: Buffer;
  actual?: Buffer;
  diff?: Buffer;
}
