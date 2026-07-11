import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import vue from "@vitejs/plugin-vue";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    // Node-side: vite plugin, CSF parser, MCP, CLI. Runs in Node only.
    {
      entry: {
        index: "./src/index.ts",
        plugin: "./src/plugin/index.ts",
        mcp: "./src/mcp/index.ts",
        cli: "./src/cli/index.ts",
      },
      format: ["esm"],
      platform: "node",
      target: "node20",
      dts: true,
      clean: false,
      sourcemap: true,
      minify: false,
    },
    // Browser-side: iframe boot, framework adapters.
    {
      entry: {
        boot: "./src/boot/index.ts",
        react: "./src/react/index.ts",
        foldkit: "./src/foldkit/index.ts",
        solid: "./src/solid/index.ts",
        vue: "./src/vue/index.ts",
        svelte: "./src/svelte/index.ts",
      },
      format: ["esm"],
      platform: "browser",
      target: "es2022",
      dts: true,
      clean: false,
      sourcemap: true,
      minify: false,
    },
    // openstory/test: pure re-export of testing libs. The bundler can't inline
    // jest-dom's vitest module augmentation (it imports a type that isn't
    // re-exported from its own matchers.d.ts), so DTS is emitted by hand from
    // ./scripts/build-test-dts.mjs and shipped as dist/test.d.ts.
    {
      entry: { test: "./src/test/index.ts" },
      format: ["esm"],
      platform: "browser",
      target: "es2022",
      dts: false,
      clean: false,
      sourcemap: true,
      minify: false,
    },
  ],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/shell/src/main.tsx"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/**", "tests/renderers/**"],
        },
      },
      {
        plugins: [vue(), svelte(), solid()],
        resolve: {
          conditions: ["browser", "development"],
        },
        test: {
          name: "renderers",
          include: ["tests/renderers/**/*.test.ts"],
          environment: "happy-dom",
          server: {
            deps: {
              inline: ["svelte", /\.svelte$/],
            },
          },
        },
      },
      {
        plugins: [react()],
        resolve: {
          conditions: ["browser", "development"],
          alias: { "@": fileURLToPath(new URL("./src/shell/src", import.meta.url)) },
        },
        test: {
          name: "shell",
          include: ["tests/shell-dom/**/*.test.tsx"],
          environment: "happy-dom",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
