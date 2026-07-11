import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { openstory } from "foldcase/plugin";

const REACT_FILE_PATTERN = /\.react\.tsx$/;
const REACT_GRAB_ROOT = "/Users/aidenybai/Developer/react-grab/packages/react-grab";

const reactGrabCssText = (): Plugin => {
  const VIRTUAL_PREFIX = "\0openstory-css-text:";
  const VIRTUAL_SUFFIX = ".js";
  return {
    name: "openstory-fixture:react-grab-css-text",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith("/dist/styles.css")) return;
      if (!importer?.startsWith(REACT_GRAB_ROOT)) return;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return;
      return `${VIRTUAL_PREFIX}${resolved.id}${VIRTUAL_SUFFIX}`;
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return;
      const filePath = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length);
      const text = await readFile(filePath, "utf8");
      return `export default ${JSON.stringify(text)};`;
    },
  };
};

export default defineConfig({
  plugins: [
    reactGrabCssText(),
    openstory({
      framework: "solid",
      // playground/ contains cross-framework stories that mount React inside
      // Solid via createRoot. The Solid adapter handles the outer mount; the
      // React mount happens inside the user's component.
      stories: ["stories/**/*.stories.{ts,tsx}"],
      preview: "./preview.tsx",
    }),
    solid({
      exclude: [REACT_FILE_PATTERN],
    }),
  ],
  resolve: {
    dedupe: ["solid-js", "solid-js/web"],
    alias: {
      // Point bare `react-grab` and subpath imports to the local checkout.
      "react-grab/dist/styles.css": resolve(REACT_GRAB_ROOT, "dist/styles.css"),
      "react-grab/src": resolve(REACT_GRAB_ROOT, "src"),
      "react-grab": resolve(REACT_GRAB_ROOT, "src/index.ts"),
    },
  },
  define: {
    "process.env.VERSION": JSON.stringify("[DEV]"),
  },
  // Cross-framework .react.tsx files use React's automatic JSX runtime.
  // The Solid plugin transforms .tsx first; .react.tsx falls through to
  // esbuild which needs React JSX config to compile them.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  server: {
    port: 6006,
    fs: {
      // Allow serving files from the workspace root *and* the react-grab
      // checkout (which is outside this workspace).
      allow: ["../../../../../", REACT_GRAB_ROOT],
    },
  },
});
