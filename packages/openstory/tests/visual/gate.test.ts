import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import { runVisualGate } from "../../src/visual/gate.js";
import { baselinePathFor } from "../../src/visual/baseline.js";
import type { VisualJudge } from "../../src/visual/types.js";

const solidPng = (rgba: [number, number, number, number]): Buffer => {
  const png = new PNG({ width: 20, height: 20 });
  for (let index = 0; index < 20 * 20; index += 1) {
    png.data[index * 4] = rgba[0];
    png.data[index * 4 + 1] = rgba[1];
    png.data[index * 4 + 2] = rgba[2];
    png.data[index * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
};

const white = solidPng([255, 255, 255, 255]);
const oneBlackPixel = ((): Buffer => {
  const png = PNG.sync.read(white);
  png.data[0] = 0;
  png.data[1] = 0;
  png.data[2] = 0;
  png.data[3] = 255;
  return PNG.sync.write(png);
})();
const black = solidPng([0, 0, 0, 255]);

const freshDir = (): string => mkdtempSync(join(tmpdir(), "foldcase-gate-"));

describe("runVisualGate — orchestrate capture → compare → report", () => {
  it("captures each showcase and builds a pass report against matching baselines", async () => {
    const dir = freshDir();
    writeFileSync(baselinePathFor(dir, "a"), white);
    writeFileSync(baselinePathFor(dir, "b"), white);

    const report = await runVisualGate({
      showcaseIds: ["a", "b"],
      capture: async () => white,
      baselineDir: dir,
      mode: "check",
    });

    expect(report.verdict).toBe("pass");
    expect(report.comparisons.map((comparison) => comparison.showcaseId)).toEqual(["a", "b"]);
  });

  it("surfaces unresolved and fail distinctly in one run", async () => {
    const dir = freshDir();
    writeFileSync(baselinePathFor(dir, "amb"), white);
    writeFileSync(baselinePathFor(dir, "bad"), white);

    const report = await runVisualGate({
      showcaseIds: ["amb", "bad"],
      capture: async (id) => (id === "amb" ? oneBlackPixel : black),
      baselineDir: dir,
      mode: "check",
      thresholds: { passRatio: 0.001, unresolvedRatio: 0.5 },
    });

    expect(report.counts.unresolved).toBe(1);
    expect(report.counts.fail).toBe(1);
    expect(report.verdict).toBe("fail");
  });

  it("records a render-error fail when capture throws", async () => {
    const dir = freshDir();
    const report = await runVisualGate({
      showcaseIds: ["boom"],
      capture: async () => {
        throw new Error("render blew up");
      },
      baselineDir: dir,
      mode: "check",
    });
    expect(report.verdict).toBe("fail");
    expect(report.comparisons[0]?.reason).toBe("render-error");
  });

  it("routes unresolved comparisons through a provided judge", async () => {
    const dir = freshDir();
    writeFileSync(baselinePathFor(dir, "amb"), white);
    const judge: VisualJudge = { resolve: async () => "pass" };

    const report = await runVisualGate({
      showcaseIds: ["amb"],
      capture: async () => oneBlackPixel,
      baselineDir: dir,
      mode: "check",
      thresholds: { passRatio: 0.001, unresolvedRatio: 0.5 },
      judge,
    });

    expect(report.verdict).toBe("pass");
    expect(report.comparisons[0]?.resolvedBy).toBe("llm-judge");
  });
});
