import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import type { ViteDevServer } from "vite";

import { openstory } from "../../src/plugin/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "foldkit-basic");

let server: ViteDevServer | undefined;
let baseUrl: string;
let browser: Browser | undefined;

interface CapturedViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  targets: string[];
}

const collectA11yViolations = async (page: Page, storyId: string): Promise<CapturedViolation[]> => {
  await page.addInitScript(() => {
    (window as unknown as { __a11y?: unknown }).__a11y = undefined;
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string; violations?: unknown };
      if (data?.source === "openstory" && data.type === "a11y") {
        (window as unknown as { __a11y?: unknown }).__a11y = data.violations ?? [];
      }
    });
  });

  await page.goto(`${baseUrl}/__story/${storyId}?a11y=1`, { waitUntil: "networkidle" });

  const handle = await page.waitForFunction(
    () => (window as unknown as { __a11y?: unknown }).__a11y,
    undefined,
    { timeout: 15_000 },
  );
  const violations = await handle.jsonValue();
  return violations as CapturedViolation[];
};

describe("a11y integration: axe at the mount boundary", () => {
  beforeAll(async () => {
    const { createServer } = await import("vite");
    server = await createServer({
      root: fixtureRoot,
      configFile: false,
      appType: "custom",
      plugins: [
        openstory({
          framework: "foldkit",
          stories: ["stories/**/*.stories.ts"],
        }),
      ],
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

  const newPage = async (): Promise<Page> => {
    if (!browser) throw new Error("browser not initialized");
    return browser.newPage();
  };

  it("reports an image-alt violation for a story with an <img> missing alt", async () => {
    const page = await newPage();
    try {
      const violations = await collectA11yViolations(page, "a11y-image--violation");
      const ruleIds = violations.map((violation) => violation.id);
      expect(ruleIds).toContain("image-alt");
      const imageAlt = violations.find((violation) => violation.id === "image-alt");
      expect(imageAlt?.helpUrl).toContain("image-alt");
      expect(imageAlt?.targets.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("reports no violations for a clean story", async () => {
    const page = await newPage();
    try {
      const violations = await collectA11yViolations(page, "a11y-image--clean");
      const ruleIds = violations.map((violation) => violation.id);
      expect(ruleIds).not.toContain("image-alt");
    } finally {
      await page.close();
    }
  }, 30_000);
});
