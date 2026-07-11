import type { Page } from "playwright";

import { OPENSTORY_ROOT_ELEMENT_ID, PARENT_MESSAGE_SOURCE, STORY_PATH_PREFIX } from "../constants.js";

export interface CaptureShowcaseOptions {
  page: Page;
  baseUrl: string;
  showcaseId: string;
  settleMs?: number;
  navigationTimeoutMs?: number;
}

const DEFAULT_SETTLE_MS = 600;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;

/**
 * Render a Showcase in a headless Chromium page and screenshot its canvas.
 *
 * The canvas is the iframe's `#openstory-root` served by the dev server / plugin — the
 * same surface the integration render tests drive — so this works without the (currently
 * unbuildable) standalone shell. If a Showcase has a `play`, we wait for it to settle so
 * the baseline captures the post-interaction state deterministically.
 */
export const captureShowcase = async (options: CaptureShowcaseOptions): Promise<Buffer> => {
  const { page, baseUrl, showcaseId } = options;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;

  await page.addInitScript((source) => {
    (window as unknown as { __playStatus?: string }).__playStatus = undefined;
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string; status?: string };
      if (data?.source === source && data.type === "play-status" && data.status) {
        (window as unknown as { __playStatus?: string }).__playStatus = data.status;
      }
    });
  }, PARENT_MESSAGE_SOURCE);

  await page.goto(`${baseUrl}${STORY_PATH_PREFIX}${showcaseId}`, {
    waitUntil: "networkidle",
    timeout: navigationTimeoutMs,
  });

  const root = page.locator(`#${OPENSTORY_ROOT_ELEMENT_ID}`);
  await root.waitFor({ state: "attached", timeout: navigationTimeoutMs });

  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    const status = await page.evaluate(
      () => (window as unknown as { __playStatus?: string }).__playStatus,
    );
    if (status === "passed" || status === "failed") break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  const target = (await root.count()) > 0 ? root : page.locator("body");
  return target.screenshot({ type: "png" });
};
