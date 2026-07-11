// Standalone visual snapshot gate runner. Boots the foldkit-basic fixture in a headless
// Chromium, screenshots each covered Showcase, and gates it against committed baselines
// with a THREE-STATE outcome surfaced via the process exit code:
//
//   0  pass        every Showcase matches its baseline within tolerance
//   2  unresolved  at least one diff is in the ambiguous band — "changed, needs a decision"
//   1  fail        a hard mismatch, a missing baseline, or a render error
//
// Usage:
//   pnpm exec tsx scripts/visual-gate.ts            # check (CI)
//   pnpm exec tsx scripts/visual-gate.ts --update   # accept current renders as baselines
//
// The runner targets the integration fixture as the demonstrable vertical slice; pointing
// it at an arbitrary consumer project is a follow-up (see docs/visual-snapshots.md).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer, type ViteDevServer } from "vite";

import { openstory } from "../src/plugin/index.js";
import { captureShowcase } from "../src/visual/capture.js";
import { runVisualGate } from "../src/visual/gate.js";
import { exitCodeForReport, formatReport } from "../src/visual/report.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "..", "tests", "integration", "fixtures", "foldkit-basic");
const baselineDir = join(here, "..", "tests", "integration", "__screenshots__");

const COVERED_SHOWCASES = ["foldkit-counter--basic", "a11y-image--clean"];
const mode = process.argv.includes("--update") || process.argv.includes("-u") ? "update" : "check";

const main = async (): Promise<number> => {
  const server: ViteDevServer = await createServer({
    root: fixtureRoot,
    configFile: false,
    appType: "custom",
    plugins: [openstory({ framework: "foldkit", stories: ["stories/**/*.stories.ts"] })],
    server: { port: 0, host: "127.0.0.1", strictPort: false },
    logLevel: "silent",
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new TypeError("dev server has no address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({ headless: true });

  try {
    const report = await runVisualGate({
      showcaseIds: COVERED_SHOWCASES,
      capture: async (showcaseId) => {
        const page = await browser.newPage();
        try {
          return await captureShowcase({ page, baseUrl, showcaseId });
        } finally {
          await page.close();
        }
      },
      baselineDir,
      mode,
    });

    process.stdout.write(`${formatReport(report)}\n`);
    return exitCodeForReport(report);
  } finally {
    await browser.close();
    await Promise.race([
      server.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
};

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`visual-gate crashed: ${String(error)}\n`);
    process.exit(1);
  });
