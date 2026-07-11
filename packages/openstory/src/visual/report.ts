import { VISUAL_EXIT_FAIL, VISUAL_EXIT_PASS, VISUAL_EXIT_UNRESOLVED } from "./constants.js";
import type { VisualComparison, VisualReport, VisualVerdict } from "./types.js";

const VERDICT_SEVERITY: Record<VisualVerdict, number> = {
  pass: 0,
  unresolved: 1,
  fail: 2,
};

export const buildReport = (comparisons: Array<VisualComparison>): VisualReport => {
  const counts: Record<VisualVerdict, number> = { pass: 0, unresolved: 0, fail: 0 };
  let verdict: VisualVerdict = "pass";

  for (const comparison of comparisons) {
    counts[comparison.verdict] += 1;
    if (VERDICT_SEVERITY[comparison.verdict] > VERDICT_SEVERITY[verdict]) {
      verdict = comparison.verdict;
    }
  }

  return { comparisons, counts, verdict };
};

export const exitCodeForReport = (report: VisualReport): number => {
  switch (report.verdict) {
    case "pass":
      return VISUAL_EXIT_PASS;
    case "unresolved":
      return VISUAL_EXIT_UNRESOLVED;
    case "fail":
      return VISUAL_EXIT_FAIL;
  }
};

const VERDICT_MARK: Record<VisualVerdict, string> = {
  pass: "✓ pass      ",
  unresolved: "? unresolved",
  fail: "✗ fail      ",
};

export const formatReport = (report: VisualReport): string => {
  const lines: Array<string> = [];
  lines.push("Foldcase visual snapshot gate");
  lines.push("");

  for (const comparison of report.comparisons) {
    const percent = (comparison.mismatchRatio * 100).toFixed(2);
    const reason = comparison.reason ? ` (${comparison.reason})` : "";
    lines.push(
      `  ${VERDICT_MARK[comparison.verdict]}  ${comparison.showcaseId}  ${percent}% diff${reason}`,
    );
  }

  lines.push("");
  lines.push(
    `  ${report.counts.pass} pass · ${report.counts.unresolved} unresolved · ${report.counts.fail} fail`,
  );
  lines.push(`  verdict: ${report.verdict.toUpperCase()}`);

  if (report.counts.unresolved > 0) {
    lines.push("");
    lines.push("  unresolved = changed, needs a decision. Re-run with --update to accept the new");
    lines.push("  baselines, or plug in a VisualJudge to auto-resolve (see src/visual/judge.ts).");
  }

  return lines.join("\n");
};
