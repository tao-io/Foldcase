import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCsf } from "../../src/csf/parser.js";
import type { PropSchema } from "../../src/utils/extract-props.js";
import { deriveStoryOutputPath, renderCsfStory } from "../../src/utils/render-csf-story.js";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "openstory-render-csf-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const renderBasic = (props: PropSchema[], componentName = "Widget") =>
  renderCsfStory({
    componentName,
    componentSourceAbsolutePath: join(projectRoot, "src/components/widget.tsx"),
    componentIsDefaultExport: false,
    framework: "react",
    projectRoot,
    storyOutputAbsolutePath: join(projectRoot, "src/components/widget.stories.tsx"),
    props,
  });

const expectParses = (source: string): void => {
  parseCsf(source, {
    filename: "widget.stories.tsx",
    makeTitle: (givenTitle) => givenTitle ?? "Untitled",
  });
};

describe("renderCsfStory - basic shape", () => {
  it("emits a named import, meta with title and component, and a Default story", () => {
    const rendered = renderBasic([]);
    expect(rendered.source).toContain(`import { Widget } from "./widget";`);
    expect(rendered.source).toContain(`title: "Components/Widget"`);
    expect(rendered.source).toContain(`component: Widget`);
    expect(rendered.source).toContain(`export const Default: Story = {};`);
    expect(rendered.storyExportNames).toEqual(["Default"]);
  });

  it("uses a default-style import when the component is a default export", () => {
    const rendered = renderCsfStory({
      componentName: "Widget",
      componentSourceAbsolutePath: join(projectRoot, "src/components/widget.tsx"),
      componentIsDefaultExport: true,
      framework: "react",
      projectRoot,
      storyOutputAbsolutePath: join(projectRoot, "src/components/widget.stories.tsx"),
      props: [],
    });
    expect(rendered.source).toContain(`import Widget from "./widget";`);
  });

  it("imports from the framework-specific adapter", () => {
    const reactRendered = renderBasic([]);
    expect(reactRendered.source).toContain(`from "foldcase/react"`);
    const solidRendered = renderCsfStory({
      componentName: "Widget",
      componentSourceAbsolutePath: join(projectRoot, "src/components/widget.tsx"),
      componentIsDefaultExport: false,
      framework: "solid",
      projectRoot,
      storyOutputAbsolutePath: join(projectRoot, "src/components/widget.stories.tsx"),
      props: [],
    });
    expect(solidRendered.source).toContain(`from "foldcase/solid"`);
  });

  it("computes the import specifier relative to the story output path", () => {
    const rendered = renderCsfStory({
      componentName: "Widget",
      componentSourceAbsolutePath: join(projectRoot, "src/components/widget.tsx"),
      componentIsDefaultExport: false,
      framework: "react",
      projectRoot,
      storyOutputAbsolutePath: join(projectRoot, "src/stories/widget.stories.tsx"),
      props: [],
    });
    expect(rendered.importSpecifier).toBe("../components/widget");
  });

  it("round-trips through the openstory CSF parser", () => {
    const rendered = renderBasic([
      { name: "variant", optional: true, kind: "enum", options: ["primary", "ghost"] },
      { name: "label", optional: false, kind: "string" },
    ]);
    expect(() => expectParses(rendered.source)).not.toThrow();
  });
});

describe("renderCsfStory - variant prop", () => {
  it("emits one story per enum option (skipping the default)", () => {
    const rendered = renderBasic([
      {
        name: "variant",
        optional: true,
        kind: "enum",
        options: ["primary", "ghost", "danger"],
        defaultValue: "primary",
      },
    ]);
    expect(rendered.storyExportNames).toEqual(["Default", "Ghost", "Danger"]);
  });

  it("prefers `variant` over other enum props as the story driver", () => {
    const rendered = renderBasic([
      { name: "size", optional: true, kind: "enum", options: ["sm", "md"] },
      {
        name: "variant",
        optional: true,
        kind: "enum",
        options: ["primary", "ghost"],
        defaultValue: "primary",
      },
    ]);
    expect(rendered.storyExportNames).toEqual(["Default", "Ghost"]);
  });

  it("falls back to the first enum prop when no canonical variant name is present", () => {
    const rendered = renderBasic([
      { name: "intent", optional: false, kind: "enum", options: ["info", "warning"] },
    ]);
    expect(rendered.storyExportNames).toContain("Warning");
  });

  it("prefixes numeric enum option names so they are valid JS identifiers", () => {
    const rendered = renderBasic([
      {
        name: "gridCols",
        optional: true,
        kind: "enum",
        options: [1, 2, 3, 4],
        defaultValue: 2,
      },
    ]);
    expect(rendered.storyExportNames).toEqual(["Default", "GridCols1", "GridCols3", "GridCols4"]);
    expect(rendered.source).not.toMatch(/export const \d/);
  });

  it("caps variant story explosion when an enum has too many options", () => {
    const manyOptions = Array.from({ length: 50 }, (_, index) => `option${index}`);
    const rendered = renderBasic([
      { name: "name", optional: false, kind: "enum", options: manyOptions },
    ]);
    expect(rendered.storyExportNames.length).toBeLessThanOrEqual(13);
    expect(rendered.storyExportNames[0]).toBe("Default");
  });
});

describe("renderCsfStory - special-case stories", () => {
  it("emits a Loading story when a loading-like boolean prop is present", () => {
    const rendered = renderBasic([
      { name: "isLoading", optional: true, kind: "boolean", defaultValue: false },
    ]);
    expect(rendered.storyExportNames).toContain("Loading");
    expect(rendered.source).toContain("isLoading: true");
  });

  it("emits a Disabled story for a disabled-like boolean prop", () => {
    const rendered = renderBasic([{ name: "disabled", optional: true, kind: "boolean" }]);
    expect(rendered.storyExportNames).toContain("Disabled");
  });

  it("emits Open, Pressed, and Selected stories for matching boolean prop names", () => {
    const rendered = renderBasic([
      { name: "open", optional: true, kind: "boolean" },
      { name: "pressed", optional: true, kind: "boolean" },
      { name: "checked", optional: true, kind: "boolean" },
    ]);
    expect(rendered.storyExportNames).toEqual(
      expect.arrayContaining(["Default", "Open", "Pressed", "Selected"]),
    );
    expect(rendered.source).toContain("open: true");
    expect(rendered.source).toContain("pressed: true");
    expect(rendered.source).toContain("checked: true");
  });
});

describe("renderCsfStory - args and argTypes", () => {
  it("populates args with prop defaultValues", () => {
    const rendered = renderBasic([
      {
        name: "variant",
        optional: true,
        kind: "enum",
        options: ["primary", "ghost"],
        defaultValue: "primary",
      },
    ]);
    expect(rendered.source).toMatch(/args:\s*\{\s*variant:\s*"primary"/);
  });

  it("emits a select control with options for enum props", () => {
    const rendered = renderBasic([
      { name: "variant", optional: true, kind: "enum", options: ["primary", "ghost"] },
    ]);
    expect(rendered.source).toMatch(/variant:\s*\{\s*control:\s*"select",/);
    expect(rendered.source).toContain(`"primary"`);
    expect(rendered.source).toContain(`"ghost"`);
  });

  it("omits noise like className and ref from args and argTypes", () => {
    const rendered = renderBasic([
      { name: "className", optional: true, kind: "string" },
      { name: "ref", optional: true, kind: "unknown" },
      { name: "variant", optional: true, kind: "enum", options: ["primary"] },
    ]);
    expect(rendered.source).not.toContain("className:");
    expect(rendered.source).not.toContain("ref:");
  });

  it("omits `*Ref` named props, `as`, `asChild`, and `render` from args and argTypes", () => {
    const rendered = renderBasic([
      { name: "containerRef", optional: true, kind: "function" },
      { name: "textareaRef", optional: true, kind: "function" },
      { name: "as", optional: true, kind: "string" },
      { name: "asChild", optional: true, kind: "boolean" },
      { name: "render", optional: true, kind: "function" },
      { name: "label", optional: false, kind: "string" },
    ]);
    expect(rendered.source).not.toContain("containerRef:");
    expect(rendered.source).not.toContain("textareaRef:");
    expect(rendered.source).not.toContain("as:");
    expect(rendered.source).not.toContain("asChild:");
    expect(rendered.source).not.toContain("render:");
    expect(rendered.source).toContain("label:");
  });

  it("fills required ref-named props with `{ current: null }` so `.current` access is safe", () => {
    const rendered = renderBasic([
      { name: "containerRef", optional: false, kind: "function" },
      { name: "textareaRef", optional: true, kind: "function" },
    ]);
    expect(rendered.source).toMatch(/containerRef:\s*\{\s*current:\s*null/);
    expect(rendered.source).not.toContain("textareaRef:");
  });

  it("defaults required array props to [] and required object props to {} so the component does not crash", () => {
    const rendered = renderBasic([
      { name: "items", optional: false, kind: "array" },
      { name: "config", optional: false, kind: "object" },
      { name: "optionalItems", optional: true, kind: "array" },
    ]);
    expect(rendered.source).toMatch(/items:\s*\[\]/);
    expect(rendered.source).toMatch(/config:\s*\{\}/);
    expect(rendered.source).not.toContain("optionalItems:");
  });

  it("omits unknown and bare function props from args", () => {
    const rendered = renderBasic([
      { name: "onClick", optional: true, kind: "function" },
      { name: "mystery", optional: false, kind: "unknown" },
    ]);
    expect(rendered.source).not.toContain("onClick:");
    expect(rendered.source).not.toContain("mystery:");
  });

  it("uses the component name as the children value when children is a node prop", () => {
    const rendered = renderBasic([{ name: "children", optional: true, kind: "node" }]);
    expect(rendered.source).toMatch(/children:\s*"Hello world"/);
  });

  it("attaches descriptions to argTypes", () => {
    const rendered = renderBasic([
      {
        name: "variant",
        optional: true,
        kind: "enum",
        options: ["primary"],
        description: "Visual style",
      },
    ]);
    expect(rendered.source).toContain(`description: "Visual style"`);
  });
});

describe("deriveStoryOutputPath", () => {
  it("places the story file next to the component with .stories.tsx extension", () => {
    const result = deriveStoryOutputPath("/abs/components/button.tsx");
    expect(result).toBe("/abs/components/button.stories.tsx");
  });

  it("preserves the source extension", () => {
    expect(deriveStoryOutputPath("/abs/x/Card.jsx")).toBe("/abs/x/Card.stories.jsx");
    expect(deriveStoryOutputPath("/abs/x/widget.ts")).toBe("/abs/x/widget.stories.ts");
  });
});
