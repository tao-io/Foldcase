import { describe, expect, it } from "vitest";
import { synthesizeStoryEntry } from "../../src/plugin/virtual-modules.js";
import type { Framework, ManifestStory } from "../../src/types.js";

const baseSynthesizedStory: ManifestStory = {
  id: "components-button--button",
  name: "Button",
  title: "Components/Button",
  importPath: "src/components/Button.tsx",
  exportName: "Default",
  componentPath: "Button",
  argTypes: {},
  initialArgs: {},
  parameters: {},
  tags: ["components"],
  hasPlay: false,
  hasBeforeEach: false,
  hasRender: true,
  synthesized: { componentExport: "Button" },
};

const FRAMEWORK_RENDER_EXPECTATIONS: Record<Framework, { importLine: RegExp; render: RegExp }> = {
  react: {
    importLine: /from\s+"react"/,
    render: /__openstoryCreateElement\(__openstoryComponent, args\)/,
  },
  foldkit: {
    importLine: /foldcase\/foldkit/,
    render: /\(\) => __openstoryComponent/,
  },
  solid: {
    importLine: /from\s+"solid-js"/,
    render: /__openstoryCreateComponent\(__openstoryComponent, args\)/,
  },
  vue: {
    importLine: /from\s+"vue"/,
    render: /__openstoryH\(__openstoryComponent, args\)/,
  },
  svelte: {
    importLine: /foldcase\/svelte/,
    render: /\{ component: __openstoryComponent, props: args \}/,
  },
};

describe("synthesizeStoryEntry - synthesized component stories", () => {
  for (const framework of Object.keys(FRAMEWORK_RENDER_EXPECTATIONS) as Framework[]) {
    it(`emits a render function for ${framework}`, () => {
      const entry = synthesizeStoryEntry({
        story: baseSynthesizedStory,
        framework,
        previewPath: undefined,
        storyAbsolutePath: "/abs/src/components/Button.tsx",
      });

      const expectations = FRAMEWORK_RENDER_EXPECTATIONS[framework];
      expect(entry).toMatch(expectations.importLine);
      expect(entry).toMatch(expectations.render);
      expect(entry).toMatch(
        /storyModule: \{ default: __openstoryMeta, Default: __openstoryStory \}/,
      );
      expect(entry).toContain(`__openstoryComponentModule["Button"]`);
      expect(entry).toContain(`title: "Components/Button"`);
      expect(entry).toContain(`id: "components-button--button"`);
      expect(entry).toContain(`exportName: "Default"`);
    });
  }

  it("references module.default for default-export components", () => {
    const entry = synthesizeStoryEntry({
      story: { ...baseSynthesizedStory, synthesized: { componentExport: "default" } },
      framework: "react",
      previewPath: undefined,
      storyAbsolutePath: "/abs/src/Card.tsx",
    });
    expect(entry).toContain(`__openstoryComponentModule["default"]`);
  });

  it("includes the preview import when a preview path is supplied", () => {
    const entry = synthesizeStoryEntry({
      story: baseSynthesizedStory,
      framework: "react",
      previewPath: "/abs/preview.tsx",
      storyAbsolutePath: "/abs/src/components/Button.tsx",
    });
    expect(entry).toContain("import preview from");
    expect(entry).not.toContain("const preview = undefined;");
  });

  it("skips the helper import line for Svelte", () => {
    const entry = synthesizeStoryEntry({
      story: { ...baseSynthesizedStory, synthesized: { componentExport: "default" } },
      framework: "svelte",
      previewPath: undefined,
      storyAbsolutePath: "/abs/src/Counter.svelte",
    });
    expect(entry).not.toMatch(/import \{ createElement/);
    expect(entry).not.toMatch(/import \{ h /);
    expect(entry).not.toMatch(/import \{ createComponent/);
  });
});

describe("synthesizeStoryEntry - regular stories", () => {
  it("keeps emitting the original storyModule import for non-synthesized stories", () => {
    const entry = synthesizeStoryEntry({
      story: { ...baseSynthesizedStory, synthesized: undefined, exportName: "Primary" },
      framework: "react",
      previewPath: undefined,
      storyAbsolutePath: "/abs/src/components/Button.stories.tsx",
    });
    expect(entry).toContain(`import(`);
    expect(entry).toContain(`exportName: "Primary"`);
    expect(entry).toContain(`surfaceModuleLoadError`);
    expect(entry).not.toContain("__openstoryComponentModule");
  });
});
