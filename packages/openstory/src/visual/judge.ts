import type { VisualComparison, VisualJudge } from "./types.js";

/**
 * Give an optional {@link VisualJudge} a chance to resolve each "unresolved" comparison
 * into a firm pass/fail. Comparisons that already passed or failed are passed through
 * untouched, and a judge that returns "unresolved" (abstains) leaves the diff as-is.
 * When no judge is supplied the input is returned verbatim — the default is a
 * deterministic, human-in-the-loop gate.
 */
export const applyJudge = async (
  comparisons: ReadonlyArray<VisualComparison>,
  judge: VisualJudge | undefined,
): Promise<Array<VisualComparison>> => {
  if (!judge) return [...comparisons];

  return Promise.all(
    comparisons.map(async (comparison) => {
      if (comparison.verdict !== "unresolved") return comparison;

      const verdict = await judge.resolve({
        showcaseId: comparison.showcaseId,
        mismatchRatio: comparison.mismatchRatio,
      });

      if (verdict === "unresolved") return comparison;

      return { ...comparison, verdict, resolvedBy: "llm-judge" as const };
    }),
  );
};
