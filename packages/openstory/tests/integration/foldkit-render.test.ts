import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";
import type { ViteDevServer } from "vite";

import { openstory } from "../../src/plugin/index.js";
import { SHELL_MESSAGE_SOURCE } from "../../src/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "foldkit-basic");

let server: ViteDevServer | undefined;
let baseUrl: string;
let browser: Browser | undefined;

interface PlayResult {
  status: "running" | "passed" | "failed" | null;
  errors: string[];
}

declare global {
  interface Window {
    __captureOpenstoryPlayStatus: (status: string) => void;
  }
}

const renderAndCollect = async (
  page: Page,
  url: string,
  timeoutMs = 10_000,
): Promise<PlayResult> => {
  const result: PlayResult = { status: null, errors: [] };

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") result.errors.push(message.text());
  });

  await page.exposeFunction("__captureOpenstoryPlayStatus", (status: string) => {
    if (status === "running" || status === "passed" || status === "failed") {
      result.status = status;
    }
  });

  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string; status?: string };
      if (data?.source === "openstory" && data.type === "play-status" && data.status) {
        window.__captureOpenstoryPlayStatus(data.status);
      }
    });
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

  const deadline = Date.now() + 5_000;
  while (result.status === "running" || result.status === null) {
    if (Date.now() > deadline) break;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }

  return result;
};

describe("foldkit integration: browser render", () => {
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

  it("serves Foldkit stories in the dev manifest", async () => {
    const response = await fetch(`${baseUrl}/__openstory/manifest.json`);
    expect(response.status).toBe(200);
    const manifest = (await response.json()) as {
      framework: string;
      stories: Array<{ id: string; title: string; name: string; hasPlay: boolean }>;
    };
    expect(manifest.framework).toBe("foldkit");
    expect(manifest.stories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "foldkit-counter--basic",
          title: "Foldkit/Counter",
          name: "Basic",
          hasPlay: true,
        }),
      ]),
    );
  });

  it("renders and updates a Foldkit program in Chromium", async () => {
    const page = await newPage();
    try {
      const result = await renderAndCollect(page, `${baseUrl}/__story/foldkit-counter--basic`);
      expect(result.errors.filter((error) => !error.includes("404"))).toEqual([]);
      expect(result.status).toBe("passed");
      await expect
        .poll(() => page.locator("[data-openstory-test='foldkit-count']").textContent())
        .toBe("Count: 1");
    } finally {
      await page.close();
    }
  }, 30_000);

  it("preserves the accumulated Model across an arg change (no cold remount)", async () => {
    const page = await newPage();
    try {
      const result = await renderAndCollect(page, `${baseUrl}/__story/foldkit-counter--basic`);
      expect(result.status).toBe("passed");
      await expect
        .poll(() => page.locator("[data-openstory-test='foldkit-count']").textContent())
        .toBe("Count: 1");

      await page.evaluate(
        (source) =>
          new Promise<void>((resolve) => {
            const onMessage = (event: MessageEvent): void => {
              const data = event.data as { source?: string; type?: string };
              if (data?.source === "openstory" && data.type === "args-changed") {
                window.removeEventListener("message", onMessage);
                resolve();
              }
            };
            window.addEventListener("message", onMessage);
            window.postMessage(
              { source, type: "set-args", args: { label: "Renamed" } },
              window.location.origin,
            );
          }),
        SHELL_MESSAGE_SOURCE,
      );

      await new Promise<void>((settle) => setTimeout(settle, 500));
      expect(await page.locator("[data-openstory-test='foldkit-count']").textContent()).toBe(
        "Count: 1",
      );
    } finally {
      await page.close();
    }
  }, 30_000);
});
