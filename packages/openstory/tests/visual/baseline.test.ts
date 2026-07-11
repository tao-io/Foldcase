import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import { evaluateShowcase } from "../../src/visual/baseline.js";
import { baselinePathFor } from "../../src/visual/baseline.js";

const thresholds = { passRatio: 0.001, unresolvedRatio: 0.05 };

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

const roots: string[] = [];
const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "foldcase-visual-"));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const root of roots) {
    // best-effort; the OS temp dir is reclaimed regardless
    try {
      writeFileSync(join(root, ".keep"), "");
    } catch {
      // ignore
    }
  }
});

const white = solidPng([255, 255, 255, 255]);
const nearWhite = ((): Buffer => {
  const png = PNG.sync.read(white);
  // flip exactly one of 400 pixels to black (ratio 0.0025) — a detectable, tiny diff
  png.data[0] = 0;
  png.data[1] = 0;
  png.data[2] = 0;
  png.data[3] = 255;
  return PNG.sync.write(png);
})();
const black = solidPng([0, 0, 0, 255]);

describe("evaluateShowcase — baseline management + three-state", () => {
  it("fails with no-baseline when the baseline is missing in check mode", () => {
    const dir = freshDir();
    const result = evaluateShowcase({
      showcaseId: "comp--a",
      actual: white,
      baselineDir: dir,
      thresholds,
      mode: "check",
    });
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("no-baseline");
    expect(result.baselineExisted).toBe(false);
  });

  it("writes the baseline and passes in update mode", () => {
    const dir = freshDir();
    const result = evaluateShowcase({
      showcaseId: "comp--a",
      actual: white,
      baselineDir: dir,
      thresholds,
      mode: "update",
    });
    expect(result.verdict).toBe("pass");
    expect(existsSync(baselinePathFor(dir, "comp--a"))).toBe(true);
    expect(readFileSync(baselinePathFor(dir, "comp--a")).equals(white)).toBe(true);
  });

  it("passes when the actual matches a committed baseline within tolerance", () => {
    const dir = freshDir();
    writeFileSync(baselinePathFor(dir, "comp--a"), white);
    const result = evaluateShowcase({
      showcaseId: "comp--a",
      actual: white,
      baselineDir: dir,
      thresholds,
      mode: "check",
    });
    expect(result.verdict).toBe("pass");
    expect(result.baselineExisted).toBe(true);
    expect(result.mismatchedPixels).toBe(0);
  });

  it("returns unresolved for a small ambiguous diff and writes a diff image", () => {
    const dir = freshDir();
    writeFileSync(baselinePathFor(dir, "comp--a"), white);
    const result = evaluateShowcase({
      showcaseId: "comp--a",
      actual: nearWhite,
      baselineDir: dir,
      // force the single differing pixel (1/400 = 0.0025) into the ambiguous band
      thresholds: { passRatio: 0.001, unresolvedRatio: 0.5 },
      mode: "check",
    });
    expect(result.verdict).toBe("unresolved");
    expect(result.diffPath).toBeDefined();
    expect(existsSync(result.diffPath as string)).toBe(true);
  });

  it("fails with hard-mismatch for a large diff", () => {
    const dir = freshDir();
    writeFileSync(baselinePathFor(dir, "comp--a"), white);
    const result = evaluateShowcase({
      showcaseId: "comp--a",
      actual: black,
      baselineDir: dir,
      thresholds,
      mode: "check",
    });
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("hard-mismatch");
  });

  it("fails with dimension-mismatch when sizes differ in check mode", () => {
    const dir = freshDir();
    const small = ((): Buffer => {
      const png = new PNG({ width: 10, height: 10 });
      png.data.fill(255);
      return PNG.sync.write(png);
    })();
    writeFileSync(baselinePathFor(dir, "comp--a"), small);
    const result = evaluateShowcase({
      showcaseId: "comp--a",
      actual: white,
      baselineDir: dir,
      thresholds,
      mode: "check",
    });
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("dimension-mismatch");
  });
});
