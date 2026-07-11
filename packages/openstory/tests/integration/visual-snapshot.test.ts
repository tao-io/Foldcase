// Per-Showcase visual snapshot gate (Phase 2.6). Boots the foldkit-basic fixture in a
// real headless Chromium, screenshots each covered Showcase's canvas, and runs it through
// the three-state gate (pass / unresolved / fail) against committed baselines under
// __screenshots__/. Regenerate the baselines with:  UPDATE_SNAPSHOTS=1 pnpm test:integration

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { ViteDevServer } from "vite";

import { openstory } from "../../src/plugin/index.js";
import { captureShowcase } from "../../src/visual/capture.js";
import { runVisualGate } from "../../src/visual/gate.js";
import { comparePng } from "../../src/visual/compare.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "foldkit-basic");
const baselineDir = join(here, "__screenshots__");

const COVERED_SHOWCASES = ["foldkit-counter--basic", "a11y-image--clean"] as const;
const mode = process.env.UPDATE_SNAPSHOTS ? "update" : "check";

let server: ViteDevServer | undefined;
let baseUrl: string;
let browser: Browser | undefined;

describe("visual snapshot gate: per-Showcase three-state diff", () => {
  beforeAll(async () => {
    const { createServer } = await import("vite");
    server = await createServer({
      root: fixtureRoot,
      configFile: false,
      appType: "custom",
      plugins: [openstory({ framework: "foldkit", stories: ["stories/**/*.stories.ts"] })],
      server: { port: 0, host: "127.0.0.1", strictPort: false },
      logLevel: "silent",
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new TypeError("server.httpServer has no address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (!server) return;
    await Promise.race([
      server.close(),
      new Promise<void>((resolveClose) => setTimeout(resolveClose, 2_000)),
    ]);
  }, 30_000);

  const capture = async (showcaseId: string): Promise<Buffer> => {
    if (!browser) throw new Error("browser not initialized");
    const page: Page = await browser.newPage();
    try {
      return await captureShowcase({ page, baseUrl, showcaseId });
    } finally {
      await page.close();
    }
  };

  it("gates the covered Showcases against committed baselines (three-state)", async () => {
    const report = await runVisualGate({
      showcaseIds: COVERED_SHOWCASES,
      capture,
      baselineDir,
      mode,
    });

    // In update mode we (re)write baselines and always pass; in check mode the committed
    // baselines must not regress to a hard fail. Unresolved is allowed through here — it
    // is the "needs a decision" state and is surfaced by the report / runner exit code,
    // not auto-failed.
    expect(report.counts.fail).toBe(0);
    expect(report.comparisons.map((comparison) => comparison.showcaseId)).toEqual([
      ...COVERED_SHOWCASES,
    ]);
  }, 60_000);

  it("captures a Showcase deterministically (same render diffs to ~zero against itself)", async () => {
    const first = await capture("foldkit-counter--basic");
    const second = await capture("foldkit-counter--basic");
    const result = comparePng(first, second);
    expect(result.dimensionMismatch).toBe(false);
    const ratio = result.mismatchedPixels / result.totalPixels;
    expect(ratio).toBeLessThan(0.001);
  }, 60_000);
});
