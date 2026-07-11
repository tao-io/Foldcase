import { describe, expect, it } from "vitest";
import {
  BUILTIN_BACKGROUNDS,
  BUILTIN_VIEWPORTS,
  RESET_BACKGROUND,
  RESET_VIEWPORT,
  resolveBackgroundOptions,
  resolveDefaultBackgroundName,
  resolveDefaultViewportName,
  resolveViewportOptions,
} from "../../src/shell/src/lib/viewport-backgrounds.js";

describe("resolveViewportOptions", () => {
  it("falls back to reset + built-in presets when no viewports are declared", () => {
    expect(resolveViewportOptions({})).toEqual([RESET_VIEWPORT, ...BUILTIN_VIEWPORTS]);
  });

  it("maps declared Storybook-style viewports (name + styles) after the reset option", () => {
    const options = resolveViewportOptions({
      viewport: {
        viewports: {
          phone: { name: "Phone", styles: { width: "320px", height: "568px" } },
        },
      },
    });
    expect(options).toEqual([
      RESET_VIEWPORT,
      { name: "phone", label: "Phone", width: "320px", height: "568px" },
    ]);
  });

  it("uses the key as the label and full size when a declared viewport omits fields", () => {
    const options = resolveViewportOptions({
      viewport: { viewports: { bare: {} } },
    });
    expect(options).toEqual([
      RESET_VIEWPORT,
      { name: "bare", label: "bare", width: "100%", height: "100%" },
    ]);
  });
});

describe("resolveDefaultViewportName", () => {
  it("defaults to the reset viewport when none is declared", () => {
    expect(resolveDefaultViewportName({})).toBe(RESET_VIEWPORT.name);
  });

  it("honors a declared defaultViewport", () => {
    expect(resolveDefaultViewportName({ viewport: { defaultViewport: "phone" } })).toBe("phone");
  });
});

describe("resolveBackgroundOptions", () => {
  it("falls back to reset + built-in presets when no backgrounds are declared", () => {
    expect(resolveBackgroundOptions({})).toEqual([RESET_BACKGROUND, ...BUILTIN_BACKGROUNDS]);
  });

  it("maps declared background values after the reset option", () => {
    const options = resolveBackgroundOptions({
      backgrounds: { values: [{ name: "Midnight", value: "#0b0f19" }] },
    });
    expect(options).toEqual([
      RESET_BACKGROUND,
      { name: "Midnight", label: "Midnight", value: "#0b0f19" },
    ]);
  });

  it("returns no options when backgrounds are disabled", () => {
    expect(resolveBackgroundOptions({ backgrounds: { disable: true } })).toEqual([]);
  });
});

describe("resolveDefaultBackgroundName", () => {
  it("defaults to the reset background when none is declared", () => {
    expect(resolveDefaultBackgroundName({})).toBe(RESET_BACKGROUND.name);
  });

  it("honors a declared default background name", () => {
    expect(
      resolveDefaultBackgroundName({
        backgrounds: { default: "Midnight", values: [{ name: "Midnight", value: "#0b0f19" }] },
      }),
    ).toBe("Midnight");
  });
});
