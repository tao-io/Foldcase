import {
  OPENSTORY_DEFAULT_LAYOUT,
  OPENSTORY_FRAMEWORK_TO_ADAPTER,
  OPENSTORY_LAYOUT_CLASSES,
  OPENSTORY_ROOT_ELEMENT_ID,
  VIRTUAL_NULL_PREFIX,
  VIRTUAL_STORY_ENTRY_ID,
} from "../constants.js";
import type { Framework, ManifestStory, ManifestStorySynthesized } from "../types.js";
import { escapeAttribute } from "../utils/escape-attribute.js";
import { toFsId } from "../utils/to-fs-id.js";

interface ComponentFrameworkHelpers {
  importLine: string;
  renderExpression: (componentLocal: string) => string;
}

const COMPONENT_FRAMEWORK_HELPERS: Record<Framework, ComponentFrameworkHelpers> = {
  react: {
    importLine: `import { createElement as __openstoryCreateElement } from "react";`,
    renderExpression: (componentLocal) =>
      `(args) => __openstoryCreateElement(${componentLocal}, args)`,
  },
  foldkit: {
    importLine: "",
    renderExpression: (componentLocal) => `() => ${componentLocal}`,
  },
  solid: {
    importLine: `import { createComponent as __openstoryCreateComponent } from "solid-js";`,
    renderExpression: (componentLocal) =>
      `(args) => __openstoryCreateComponent(${componentLocal}, args)`,
  },
  vue: {
    importLine: `import { h as __openstoryH } from "vue";`,
    renderExpression: (componentLocal) => `(args) => __openstoryH(${componentLocal}, args)`,
  },
  svelte: {
    importLine: "",
    renderExpression: (componentLocal) =>
      `(args) => ({ component: ${componentLocal}, props: args })`,
  },
};

export interface RenderStoryIframeHtmlOptions {
  story: ManifestStory;
  previewParameters?: Record<string, unknown>;
  projectName?: string;
  base?: string;
}

export interface SynthesizeEntryOptions {
  story: ManifestStory;
  framework: Framework;
  previewPath: string | undefined;
  storyAbsolutePath: string;
}

export const isStoryEntryId = (id: string): boolean => id.startsWith(VIRTUAL_STORY_ENTRY_ID);

export const resolveStoryEntryId = (id: string): string => `${VIRTUAL_NULL_PREFIX}${id}`;

export const parseStoryEntryParams = (id: string): { storyId: string } | undefined => {
  const cleaned = id.startsWith(VIRTUAL_NULL_PREFIX) ? id.slice(VIRTUAL_NULL_PREFIX.length) : id;
  if (!cleaned.startsWith(VIRTUAL_STORY_ENTRY_ID)) return undefined;
  const queryIndex = cleaned.indexOf("?");
  if (queryIndex === -1) return undefined;
  const storyId = new URLSearchParams(cleaned.slice(queryIndex + 1)).get("id");
  return storyId ? { storyId } : undefined;
};

const pickLayout = (parameters: Record<string, unknown> | undefined): string | undefined => {
  if (!parameters) return undefined;
  const layout = parameters["layout"];
  return typeof layout === "string" ? layout : undefined;
};

export const renderStoryIframeHtml = (options: RenderStoryIframeHtmlOptions): string => {
  const { story, previewParameters, projectName } = options;
  const layout =
    pickLayout(story.parameters) ?? pickLayout(previewParameters) ?? OPENSTORY_DEFAULT_LAYOUT;
  const bodyClassName =
    OPENSTORY_LAYOUT_CLASSES[layout] ?? OPENSTORY_LAYOUT_CLASSES[OPENSTORY_DEFAULT_LAYOUT];
  const escapedStoryId = escapeAttribute(story.id);
  const titleSuffix = projectName ? escapeAttribute(projectName) : "Openstory";
  const virtualImportSpecifier = `${VIRTUAL_STORY_ENTRY_ID}?id=${encodeURIComponent(story.id)}`;
  const initialStoryGlobal = JSON.stringify({
    id: story.id,
    name: story.name,
    title: story.title,
    exportName: story.exportName,
    importPath: story.importPath,
  });

  return `<!doctype html>
<html lang="en" data-openstory-story="${escapedStoryId}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedStoryId} · ${titleSuffix}</title>
  <style>
    html, body { margin: 0; padding: 0; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body.openstory-layout-centered  { display: grid; place-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
    body.openstory-layout-fullscreen #${OPENSTORY_ROOT_ELEMENT_ID} { min-height: 100vh; }
    body.openstory-layout-padded    #${OPENSTORY_ROOT_ELEMENT_ID} { padding: 16px; }
  </style>
  <script>window.__OPENSTORY_STORY__ = ${initialStoryGlobal};</script>
</head>
<body class="${bodyClassName}">
  <div id="${OPENSTORY_ROOT_ELEMENT_ID}"></div>
  <script type="module">import ${JSON.stringify(virtualImportSpecifier)};</script>
</body>
</html>
`;
};

export const synthesizeStoryEntry = (options: SynthesizeEntryOptions): string => {
  const { story, framework, previewPath, storyAbsolutePath } = options;
  const adapterSpecifier = OPENSTORY_FRAMEWORK_TO_ADAPTER[framework];
  const previewImport = previewPath
    ? `import preview from ${JSON.stringify(toFsId(previewPath))};`
    : "const preview = undefined;";

  if (story.synthesized) {
    return synthesizeComponentStoryEntry({
      story,
      synthesized: story.synthesized,
      framework,
      adapterSpecifier,
      previewImport,
      storyAbsolutePath,
    });
  }

  return `import { renderer } from ${JSON.stringify(adapterSpecifier)};
import { boot, surfaceModuleLoadError } from "foldcase/boot";
${previewImport}

const __openstoryStoryModulePromise = import(${JSON.stringify(toFsId(storyAbsolutePath))});

__openstoryStoryModulePromise
  .then((storyModule) => {
    boot({
      id: ${JSON.stringify(story.id)},
      exportName: ${JSON.stringify(story.exportName)},
      renderer,
      preview,
      storyModule,
    });
  })
  .catch((error) => {
    surfaceModuleLoadError(${JSON.stringify(story.id)}, error);
  });

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot.invalidate();
  });
}
`;
};

interface SynthesizeComponentEntryOptions {
  story: ManifestStory;
  synthesized: ManifestStorySynthesized;
  framework: Framework;
  adapterSpecifier: string | undefined;
  previewImport: string;
  storyAbsolutePath: string;
}

const synthesizeComponentStoryEntry = (options: SynthesizeComponentEntryOptions): string => {
  const { story, synthesized, framework, adapterSpecifier, previewImport, storyAbsolutePath } =
    options;
  const helpers = COMPONENT_FRAMEWORK_HELPERS[framework];
  const helperImport = helpers.importLine ? `${helpers.importLine}\n` : "";
  const renderExpression = helpers.renderExpression("__openstoryComponent");

  return `import { renderer } from ${JSON.stringify(adapterSpecifier)};
import { boot, surfaceModuleLoadError } from "foldcase/boot";
${previewImport}
${helperImport}
import(${JSON.stringify(toFsId(storyAbsolutePath))})
  .then((__openstoryComponentModule) => {
    const __openstoryComponent = __openstoryComponentModule[${JSON.stringify(synthesized.componentExport)}];
    const __openstoryMeta = {
      title: ${JSON.stringify(story.title)},
      component: __openstoryComponent,
      tags: ${JSON.stringify(story.tags)},
    };
    const __openstoryStory = {
      name: ${JSON.stringify(story.name)},
      render: ${renderExpression},
    };
    boot({
      id: ${JSON.stringify(story.id)},
      exportName: "Default",
      renderer,
      preview,
      storyModule: { default: __openstoryMeta, Default: __openstoryStory },
    });
  })
  .catch((error) => {
    surfaceModuleLoadError(${JSON.stringify(story.id)}, error);
  });

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot.invalidate();
  });
}
`;
};
