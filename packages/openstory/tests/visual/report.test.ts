import { describe, expect, it } from "vitest";

import { buildReport, exitCodeForReport, formatReport } from "../../src/visual/report.js";
import type { VisualComparison } from "../../src/visual/types.js";

const comparison = (
  showcaseId: string,
  verdict: VisualComparison["verdict"],
  extra: Partial<VisualComparison> = {},
): VisualComparison => ({
  showcaseId,
  verdict,
  mismatchRatio: 0,
  mismatchedPixels: 0,
  totalPixels: 100,
  baselineExisted: true,
  resolvedBy: "baseline",
  ...extra,
});

describe("buildReport — aggregate the per-Showcase verdicts", () => {
  it("counts each verdict and takes the worst as the overall verdict", () => {
    const report = buildReport([
      comparison("a", "pass"),
      comparison("b", "unresolved"),
      comparison("c", "pass"),
    ]);
    expect(report.counts).toEqual({ pass: 2, unresolved: 1, fail: 0 });
    expect(report.verdict).toBe("unresolved");
  });

  it("prefers fail over unresolved for the overall verdict", () => {
    const report = buildReport([comparison("a", "unresolved"), comparison("b", "fail")]);
    expect(report.verdict).toBe("fail");
  });

  it("is pass only when every comparison passes", () => {
    const report = buildReport([comparison("a", "pass"), comparison("b", "pass")]);
    expect(report.verdict).toBe("pass");
  });

  it("is pass for an empty set (nothing to gate)", () => {
    expect(buildReport([]).verdict).toBe("pass");
  });
});

describe("exitCodeForReport — distinct exit code per state", () => {
  it("maps pass→0, fail→1, unresolved→2", () => {
    expect(exitCodeForReport(buildReport([comparison("a", "pass")]))).toBe(0);
    expect(exitCodeForReport(buildReport([comparison("a", "fail")]))).toBe(1);
    expect(exitCodeForReport(buildReport([comparison("a", "unresolved")]))).toBe(2);
  });
});

describe("formatReport — human-readable summary", () => {
  it("surfaces the unresolved verdict distinctly and lists each showcase", () => {
    const text = formatReport(
      buildReport([
        comparison("counter--basic", "pass"),
        comparison("card--hover", "unresolved", { reason: undefined, mismatchRatio: 0.01 }),
      ]),
    );
    expect(text).toContain("counter--basic");
    expect(text).toContain("card--hover");
    expect(text.toLowerCase()).toContain("unresolved");
  });
});
