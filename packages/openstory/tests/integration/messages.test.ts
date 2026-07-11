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

interface CapturedMessage {
  tag: string;
  payload: Record<string, unknown>;
  ts: number;
}

const collectMessageStream = async (page: Page, storyId: string): Promise<CapturedMessage[]> => {
  await page.addInitScript(() => {
    (window as unknown as { __messages?: CapturedMessage[] }).__messages = [];
    (window as unknown as { __played?: boolean }).__played = false;
    window.addEventListener("message", (event) => {
      const data = event.data as {
        source?: string;
        type?: string;
        tag?: string;
        payload?: Record<string, unknown>;
        ts?: number;
        status?: string;
      };
      if (data?.source !== "openstory") return;
      if (data.type === "message" && typeof data.tag === "string") {
        (window as unknown as { __messages?: CapturedMessage[] }).__messages?.push({
          tag: data.tag,
          payload: data.payload ?? {},
          ts: data.ts ?? 0,
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
    () => (window as unknown as { __messages?: CapturedMessage[] }).__messages ?? [],
  );
  return (await handle.jsonValue()) as CapturedMessage[];
};

describe("actions integration: the Foldkit message stream reaches the shell", () => {
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

  it("posts each dispatched message in play order with tag + payload", async () => {
    const page = await newPage();
    try {
      const messages = await collectMessageStream(page, "foldkit-messages--basic");
      const tags = messages.map((message) => message.tag);
      expect(tags).toEqual(["Incremented", "Incremented", "LabelSet"]);
      const labelSet = messages.find((message) => message.tag === "LabelSet");
      expect(labelSet?.payload).toEqual({ label: "done" });
    } finally {
      await page.close();
    }
  }, 30_000);
});
