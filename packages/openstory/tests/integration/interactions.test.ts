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

interface CapturedStep {
  name: string;
  index: number;
  status: "running" | "passed" | "failed";
  error?: { message?: string };
}

const collectStepStream = async (page: Page, storyId: string): Promise<CapturedStep[]> => {
  await page.addInitScript(() => {
    (window as unknown as { __steps?: CapturedStep[] }).__steps = [];
    (window as unknown as { __played?: boolean }).__played = false;
    window.addEventListener("message", (event) => {
      const data = event.data as {
        source?: string;
        type?: string;
        name?: string;
        index?: number;
        status?: string;
        error?: { message?: string };
      };
      if (data?.source !== "openstory") return;
      if (
        data.type === "play-step" &&
        typeof data.name === "string" &&
        typeof data.index === "number"
      ) {
        (window as unknown as { __steps?: CapturedStep[] }).__steps?.push({
          name: data.name,
          index: data.index,
          status: data.status as CapturedStep["status"],
          error: data.error,
        });
      }
      if (data.type === "play-status" && (data.status === "passed" || data.status === "failed")) {
        (window as unknown as { __played?: boolean }).__played = true;
      }
    });
  });

  await page.goto(`${baseUrl}/__story/${storyId}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => (window as unknown as { __played?: boolean }).__played === true,
    undefined,
    { timeout: 15_000 },
  );
  const handle = await page.evaluateHandle(
    () => (window as unknown as { __steps?: CapturedStep[] }).__steps ?? [],
  );
  return (await handle.jsonValue()) as CapturedStep[];
};

describe("interactions integration: the play step stream reaches the shell", () => {
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

  it("posts a running->passed pair per step with monotonic indices", async () => {
    const page = await newPage();
    try {
      const steps = await collectStepStream(page, "foldkit-interactions--passing");

      expect(steps).toEqual([
        { name: "increment once", index: 0, status: "running", error: undefined },
        { name: "increment once", index: 0, status: "passed", error: undefined },
        { name: "increment again", index: 1, status: "running", error: undefined },
        { name: "increment again", index: 1, status: "passed", error: undefined },
        { name: "set the label", index: 2, status: "running", error: undefined },
        { name: "set the label", index: 2, status: "passed", error: undefined },
      ]);

      // Terminal status per step index, in order.
      const terminal = steps.filter((entry) => entry.status !== "running");
      expect(terminal.map((entry) => entry.index)).toEqual([0, 1, 2]);
      expect(terminal.every((entry) => entry.status === "passed")).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("marks the failing step failed after its running entry and stops there", async () => {
    const page = await newPage();
    try {
      const steps = await collectStepStream(page, "foldkit-interactions--failing-step");

      const byIndex = (index: number): CapturedStep[] =>
        steps.filter((entry) => entry.index === index);

      expect(byIndex(0).map((entry) => entry.status)).toEqual(["running", "passed"]);
      expect(byIndex(1).map((entry) => entry.status)).toEqual(["running", "failed"]);

      const failed = steps.find((entry) => entry.status === "failed");
      expect(failed?.name).toBe("assert an impossible count");
      expect(failed?.error?.message).toContain('step "assert an impossible count" failed');

      // A failing step aborts the play, so there is no third step.
      expect(steps.some((entry) => entry.index === 2)).toBe(false);
    } finally {
      await page.close();
    }
  }, 30_000);
});
