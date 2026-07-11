import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Canvas } from "../../src/shell/src/components/canvas.js";
import {
  RESET_BACKGROUND,
  RESET_VIEWPORT,
  type BackgroundOption,
  type ViewportOption,
} from "../../src/shell/src/lib/viewport-backgrounds.js";

const mobile: ViewportOption = { name: "mobile", label: "Mobile", width: "375px", height: "667px" };
const dark: BackgroundOption = { name: "dark", label: "Dark", value: "#1a1a1a" };

let root: Root | undefined;
let container: HTMLElement | undefined;

const render = (element: React.ReactElement): HTMLElement => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root?.render(element));
  return container;
};

afterEach(() => {
  flushSync(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const iframeOf = (host: HTMLElement): HTMLIFrameElement => {
  const iframe = host.querySelector<HTMLIFrameElement>('[data-testid="canvas-iframe"]');
  if (!iframe) throw new Error("iframe not rendered");
  return iframe;
};

const surfaceOf = (host: HTMLElement): HTMLElement => {
  const surface = host.querySelector<HTMLElement>('[data-testid="canvas-surface"]');
  if (!surface) throw new Error("surface not rendered");
  return surface;
};

const baseProps = {
  iframeRef: { current: null },
  iframeSrc: "about:blank",
  status: { rendered: true },
  storyId: "demo",
};

describe("Canvas viewport + background", () => {
  it("sizes the iframe to a chosen viewport preset", () => {
    const host = render(<Canvas {...baseProps} viewport={mobile} background={RESET_BACKGROUND} />);
    const iframe = iframeOf(host);
    expect(iframe.style.width).toBe("375px");
    expect(iframe.style.height).toBe("667px");
  });

  it("fills the canvas for the reset viewport", () => {
    const host = render(
      <Canvas {...baseProps} viewport={RESET_VIEWPORT} background={RESET_BACKGROUND} />,
    );
    const iframe = iframeOf(host);
    expect(iframe.style.width).toBe("100%");
    expect(iframe.style.height).toBe("100%");
  });

  it("recolors the surface for a chosen background preset", () => {
    const host = render(<Canvas {...baseProps} viewport={RESET_VIEWPORT} background={dark} />);
    const surface = surfaceOf(host);
    expect(surface.style.backgroundColor).toBe("#1a1a1a");
  });

  it("leaves the surface color unset for the reset (transparent) background", () => {
    const host = render(
      <Canvas {...baseProps} viewport={RESET_VIEWPORT} background={RESET_BACKGROUND} />,
    );
    const surface = surfaceOf(host);
    expect(surface.style.backgroundColor).toBe("");
  });
});
