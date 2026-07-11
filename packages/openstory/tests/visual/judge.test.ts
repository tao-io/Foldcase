import { describe, expect, it } from "vitest";

import { applyJudge } from "../../src/visual/judge.js";
import type { VisualComparison, VisualJudge } from "../../src/visual/types.js";

const comparison = (
  showcaseId: string,
  verdict: VisualComparison["verdict"],
): VisualComparison => ({
  showcaseId,
  verdict,
  mismatchRatio: 0.01,
  mismatchedPixels: 1,
  totalPixels: 100,
  baselineExisted: true,
  resolvedBy: "baseline",
});

describe("applyJudge — the optional LLM-judge seam over unresolved diffs", () => {
  it("leaves every verdict untouched when no judge is provided", async () => {
    const input = [comparison("a", "pass"), comparison("b", "unresolved")];
    const result = await applyJudge(input, undefined);
    expect(result).toEqual(input);
  });

  it("only asks the judge about unresolved comparisons", async () => {
    const asked: Array<string> = [];
    const judge: VisualJudge = {
      resolve: async (request) => {
        asked.push(request.showcaseId);
        return "pass";
      },
    };
    await applyJudge(
      [comparison("a", "pass"), comparison("b", "unresolved"), comparison("c", "fail")],
      judge,
    );
    expect(asked).toEqual(["b"]);
  });

  it("promotes the judged verdict and marks it resolved by the judge", async () => {
    const judge: VisualJudge = { resolve: async () => "fail" };
    const [resolved] = await applyJudge([comparison("b", "unresolved")], judge);
    expect(resolved?.verdict).toBe("fail");
    expect(resolved?.resolvedBy).toBe("llm-judge");
  });

  it("keeps the comparison unresolved when the judge abstains (returns unresolved)", async () => {
    const judge: VisualJudge = { resolve: async () => "unresolved" };
    const [resolved] = await applyJudge([comparison("b", "unresolved")], judge);
    expect(resolved?.verdict).toBe("unresolved");
    expect(resolved?.resolvedBy).toBe("baseline");
  });
});
