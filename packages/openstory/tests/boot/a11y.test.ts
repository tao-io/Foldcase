import { describe, expect, it } from "vitest";
import { mapAxeViolations } from "../../src/boot/a11y.js";

describe("mapAxeViolations", () => {
  it("maps an axe violation to a small JSON-safe payload", () => {
    const payload = mapAxeViolations({
      violations: [
        {
          id: "image-alt",
          impact: "critical",
          help: "Images must have alternate text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.12/image-alt",
          description: "Ensures <img> elements have alternate text",
          tags: ["wcag2a", "wcag111"],
          nodes: [{ target: ["img"], html: "<img src=x>", any: [], all: [], none: [] }],
        },
      ],
    });

    expect(payload).toEqual([
      {
        id: "image-alt",
        impact: "critical",
        help: "Images must have alternate text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.12/image-alt",
        targets: ["img"],
      },
    ]);
  });

  it("defaults a missing impact to null and flattens shadow-dom selectors", () => {
    const payload = mapAxeViolations({
      violations: [
        {
          id: "color-contrast",
          help: "Elements must meet minimum color contrast",
          helpUrl: "https://example.test/color-contrast",
          description: "contrast",
          tags: [],
          nodes: [{ target: [["host", ".inner"]], html: "", any: [], all: [], none: [] }],
        },
      ],
    });

    expect(payload[0]?.impact).toBeNull();
    expect(payload[0]?.targets).toEqual(["host .inner"]);
  });

  it("returns an empty array when there are no violations", () => {
    expect(mapAxeViolations({ violations: [] })).toEqual([]);
  });
});
