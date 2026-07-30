// ADR-0002 › Enforcement — the toolchain fence.
//
// This repository is Bun + Effect-4 + Foldkit. The React shell, CSF-3, and the
// pnpm/turbo/vite toolchain stay on the `foldkit` branch. This gate is the half
// a lint rule cannot see: files that exist, dependencies that are declared,
// extensions that are used.
//
// It is deliberately zero-dependency — `bun:test` and `node:fs` only, importing
// no project code — so it keeps working when the project itself does not.

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * Tool-owned directories — build output, caches, installed packages — at any
 * depth. The fence is about what this repository *is*, not about what a build
 * or a package manager left behind.
 */
const IGNORED_ANYWHERE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".claude",
  ".cursor",
])

/**
 * Generated directories whose names are also legitimate source directory names
 * — `src/coverage/` is the `--coverage` implementation, not a coverage report —
 * so they are ignored only at the repository root.
 */
const IGNORED_AT_ROOT = new Set(["coverage", "foldcase-docs"])

/** Every file in the repository, as a path relative to the repository root. */
const repositoryFiles = (root: string = REPO_ROOT, prefix = ""): ReadonlyArray<string> =>
  readdirSync(root).flatMap((entry) => {
    if (IGNORED_ANYWHERE.has(entry) || (prefix === "" && IGNORED_AT_ROOT.has(entry))) {
      return []
    }
    const absolute = `${root}/${entry}`
    const relative = prefix === "" ? entry : `${prefix}/${entry}`
    return statSync(absolute).isDirectory() ? repositoryFiles(absolute, relative) : [relative]
  })

const FILES = repositoryFiles()

// ── 1. A rival lockfile ──────────────────────────────────────────────────────

const RIVAL_LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"])

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/** Lockfiles belonging to a package manager that is not Bun. */
export const rivalLockfiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => RIVAL_LOCKFILES.has(basename(file)))

describe("ADR-0002 — a rival lockfile", () => {
  test("names npm, yarn and pnpm lockfiles at any level, and leaves bun.lock alone", () => {
    expect(rivalLockfiles(["bun.lock", "src/runner.ts"])).toEqual([])
    expect(rivalLockfiles(["pnpm-lock.yaml", "packages/x/yarn.lock", "package-lock.json"])).toEqual([
      "pnpm-lock.yaml",
      "packages/x/yarn.lock",
      "package-lock.json",
    ])
  })

  test("the repository carries none", () => {
    expect(rivalLockfiles(FILES)).toEqual([])
  })
})

// ── 2. A rival toolchain file ────────────────────────────────────────────────

const RIVAL_TOOLING = new Set(["pnpm-workspace.yaml", "turbo.json"])
const RIVAL_CONFIG = /^(vite|vitest)\.config\.[cm]?[jt]s$/

/** Config files belonging to the pnpm/turbo/Vite line that stayed behind. */
export const rivalToolchainFiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => {
    const name = basename(file)
    return RIVAL_TOOLING.has(name) || RIVAL_CONFIG.test(name)
  })

describe("ADR-0002 — a rival toolchain file", () => {
  test("names the pnpm/turbo/Vite configs at any level", () => {
    expect(rivalToolchainFiles(["mise.toml", "tsconfig.json", "bunfig.toml"])).toEqual([])
    expect(
      rivalToolchainFiles([
        "turbo.json",
        "pnpm-workspace.yaml",
        "apps/web/vite.config.ts",
        "vitest.config.mts",
      ]),
    ).toEqual(["turbo.json", "pnpm-workspace.yaml", "apps/web/vite.config.ts", "vitest.config.mts"])
  })

  test("the repository carries none", () => {
    expect(rivalToolchainFiles(FILES)).toEqual([])
  })
})

// ── 3. A banned dependency ───────────────────────────────────────────────────

const BANNED_PACKAGES = new Set([
  "react",
  "react-dom",
  "solid-js",
  "vue",
  "svelte",
  "vite",
  "vitest",
  "turbo",
  "storybook",
])

const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const

const isBanned = (name: string): boolean =>
  BANNED_PACKAGES.has(name) || name.startsWith("@storybook/")

/** Every banned package declared in any dependency block of a package manifest. */
export const bannedDependencies = (manifest: unknown): ReadonlyArray<string> => {
  const blocks = manifest as Record<string, Record<string, string> | undefined>
  return DEPENDENCY_BLOCKS.flatMap((block) => Object.keys(blocks[block] ?? {})).filter(isBanned)
}

const PACKAGE_JSON: unknown = JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, "utf8"))

describe("ADR-0002 — a banned dependency", () => {
  test("reads every dependency block, including peers and optionals", () => {
    expect(bannedDependencies({ dependencies: { effect: "4" } })).toEqual([])
    expect(
      bannedDependencies({
        dependencies: { react: "19" },
        devDependencies: { vitest: "3", "@storybook/react-vite": "8" },
        peerDependencies: { vue: "3" },
        optionalDependencies: { turbo: "2" },
      }),
    ).toEqual(["react", "vitest", "@storybook/react-vite", "vue", "turbo"])
  })

  test("package.json declares none", () => {
    expect(bannedDependencies(PACKAGE_JSON)).toEqual([])
  })
})

// ── 4. A foreign source file under src/ ──────────────────────────────────────

/**
 * The one sanctioned non-TypeScript source file in the repository: the Node V8
 * precise-coverage instrument that `foldcase test --coverage` spawns, because
 * Bun exposes no programmatic precise coverage (ADR-0002 › The one declared
 * exception). It is an exception *by declaration* — this list, the
 * `.oxlintrc.json` ignore list, and the ADR all name it — so a second one
 * cannot appear by accident.
 */
const NON_TYPESCRIPT_ALLOWLIST: ReadonlyArray<string> = ["src/coverage/collector.mjs"]

const FOREIGN_EXTENSION = /\.(jsx|tsx|vue|svelte|js|mjs|cjs)$/

/** Files under `src/` that are neither TypeScript nor the declared exception. */
export const foreignSourceFiles = (
  files: ReadonlyArray<string>,
  allowlist: ReadonlyArray<string> = NON_TYPESCRIPT_ALLOWLIST,
): ReadonlyArray<string> =>
  files.filter(
    (file) =>
      file.startsWith("src/") && FOREIGN_EXTENSION.test(file) && !allowlist.includes(file),
  )

const OXLINTRC = readFileSync(`${REPO_ROOT}/.oxlintrc.json`, "utf8")

describe("ADR-0002 — a foreign source file under src/", () => {
  test("names framework and plain-JavaScript sources, and spares the allowlisted one", () => {
    expect(foreignSourceFiles(["src/runner.ts", "test/fixtures/a.showcase.ts"])).toEqual([])
    expect(foreignSourceFiles(["src/coverage/collector.mjs"])).toEqual([])
    expect(
      foreignSourceFiles([
        "src/lab/Shell.tsx",
        "src/lab/Panel.svelte",
        "src/lab/Card.vue",
        "src/util.js",
        "src/coverage/second.mjs",
      ]),
    ).toEqual([
      "src/lab/Shell.tsx",
      "src/lab/Panel.svelte",
      "src/lab/Card.vue",
      "src/util.js",
      "src/coverage/second.mjs",
    ])
  })

  test("src/ carries none beyond the allowlist", () => {
    expect(foreignSourceFiles(FILES)).toEqual([])
  })

  test("the exception is exactly one file, and that file is really there", () => {
    // Widening the fence has to be a deliberate edit to this assertion, not a
    // quiet extra line in the allowlist.
    expect(NON_TYPESCRIPT_ALLOWLIST).toEqual(["src/coverage/collector.mjs"])
    expect(FILES).toContain("src/coverage/collector.mjs")
  })

  test("the exception is declared in the lint ignore list too", () => {
    // ADR-0002: "It is named in the lint ignore list and in the stack gate's
    // allowlist, so it is an exception by declaration, not by accident."
    expect(OXLINTRC).toContain("src/coverage/collector.mjs")
  })
})

// ── 5. A CSF-3 catalog ───────────────────────────────────────────────────────

const STORY_FILE = /\.stories\.[^/]+$/
const SHOWCASE_FILE = /\.showcase\.ts$/

/** Story files — the CSF-3 catalog format that stayed on the `foldkit` branch. */
export const storyFiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => STORY_FILE.test(file))

/**
 * A catalog is `export const showcases`, never a default export. A default
 * export is the CSF-3 shape (`export default meta`) wearing a new suffix.
 */
export const defaultExportCatalogs = (
  files: ReadonlyArray<string>,
  read: (file: string) => string,
): ReadonlyArray<string> =>
  files
    .filter((file) => SHOWCASE_FILE.test(file))
    .filter((file) => {
      const source = read(file)
      return source.includes("export default") || !source.includes("export const showcases")
    })

const readRepositoryFile = (file: string): string => readFileSync(`${REPO_ROOT}/${file}`, "utf8")

describe("ADR-0002 — a CSF-3 catalog", () => {
  test("names any *.stories.* file", () => {
    expect(storyFiles(["src/ui/Button.showcase.ts"])).toEqual([])
    expect(storyFiles(["src/ui/Button.stories.ts", "src/ui/Card.stories.tsx"])).toEqual([
      "src/ui/Button.stories.ts",
      "src/ui/Card.stories.tsx",
    ])
  })

  test("names a showcase file that exports a default instead of `showcases`", () => {
    const sources: Record<string, string> = {
      "a.showcase.ts": "export const showcases = []",
      "b.showcase.ts": "export default meta",
      "c.showcase.ts": "export const stories = []",
      "d.ts": "export default meta",
    }
    expect(defaultExportCatalogs(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "b.showcase.ts",
      "c.showcase.ts",
    ])
  })

  test("the repository carries neither", () => {
    expect(storyFiles(FILES)).toEqual([])
    expect(defaultExportCatalogs(FILES, readRepositoryFile)).toEqual([])
  })
})

// ── 6. A .env file ───────────────────────────────────────────────────────────

/**
 * Dotenv files, at any level and under any suffix. Configuration is read
 * through Effect `Config` at the imperative shell; a `.env` on disk means
 * something reads it.
 */
export const dotenvFiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => {
    const name = basename(file)
    return name === ".env" || name.startsWith(".env.")
  })

describe("ADR-0002 — a .env file", () => {
  test("names dotenv files at any level and under any suffix", () => {
    expect(dotenvFiles(["src/env.ts", "mise.toml", "environment.md"])).toEqual([])
    expect(dotenvFiles([".env", "apps/web/.env.local", ".env.production"])).toEqual([
      ".env",
      "apps/web/.env.local",
      ".env.production",
    ])
  })

  test("the repository carries none", () => {
    expect(dotenvFiles(FILES)).toEqual([])
  })
})

// ── 7. The runtime fence: a runtime-agnostic core, thin per-runtime shells ───
//
// ADR-0002 › Amendment 1 moved the fence from "Bun only" to "one core, many
// shells". The core is runtime-agnostic Effect; only a shell binds a runtime,
// and a shell binds exactly one. That is what makes the same `dist/` runnable
// under Node and under Bun.

/** The declared shells. Adding one is a deliberate edit to this list. */
const SHELLS: Readonly<Record<string, string>> = {
  "src/main.ts": "@effect/platform-node",
  "src/main.bun.ts": "@effect/platform-bun",
}

const PLATFORM_IMPORT = /(?:from|import)\s*\(?\s*["'`](@effect\/platform-[a-z-]+)["'`]/g

/** Every `@effect/platform-*` package a module imports, deduplicated. */
export const platformImports = (source: string): ReadonlyArray<string> => [
  ...new Set([...source.matchAll(PLATFORM_IMPORT)].map((match) => match[1] as string)),
]

/** The shipped modules: TypeScript under `src/`, minus the co-located tests. */
const SHIPPED = FILES.filter(
  (file) => file.startsWith("src/") && file.endsWith(".ts") && !file.endsWith(".test.ts"),
)

const readSource = (file: string): string => readFileSync(`${REPO_ROOT}/${file}`, "utf8")

describe("ADR-0002 — the runtime fence", () => {
  test("reads every platform package a module binds, and nothing else", () => {
    expect(platformImports('import * as Effect from "effect/Effect"')).toEqual([])
    expect(
      platformImports('import { NodeRuntime } from "@effect/platform-node"\nimport { NodeServices } from "@effect/platform-node"'),
    ).toEqual(["@effect/platform-node"])
    expect(
      platformImports('import { BunRuntime } from "@effect/platform-bun"\nawait import("@effect/platform-node")'),
    ).toEqual(["@effect/platform-bun", "@effect/platform-node"])
  })

  test("only the declared shells bind a runtime", () => {
    const binders = SHIPPED.filter((file) => platformImports(readSource(file)).length > 0)
    expect(binders.toSorted()).toEqual(Object.keys(SHELLS).toSorted())
  })

  test("each shell binds exactly the one runtime it is named for", () => {
    for (const [shell, platform] of Object.entries(SHELLS)) {
      expect(FILES).toContain(shell)
      expect(platformImports(readSource(shell))).toEqual([platform])
    }
  })

  test("every bound platform package is declared an optional peer", () => {
    // The core needs neither package, and a consumer only needs the one their
    // shell uses — so both are optional peers, and `peerDependenciesMeta` has
    // to say so for each. An undeclared or non-optional binding is a lie in the
    // manifest, which is what this checks.
    const manifest = PACKAGE_JSON as {
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
    for (const platform of Object.values(SHELLS)) {
      expect(manifest.peerDependencies?.[platform]).toBeString()
      expect(manifest.peerDependenciesMeta?.[platform]?.optional).toBe(true)
    }
  })
})

// ── 8. A bundler ─────────────────────────────────────────────────────────────
//
// ADR-0002 › Amendment 1: the published artifact is built by plain
// `tsc -b tsconfig.build.json`. `tsc` is a compiler — one `.js` and one `.d.ts`
// per source file — so the published tree is the source tree and a consumer's
// own bundler sees ordinary ESM. No bundler is a dependency, and no task calls
// one. `bun build --compile` went with them: a compiled binary resolves
// `import(path)` inside its own `/$bunfs` and so can never load an external
// `*.showcase.ts`, which is the tool's whole job.

const BUNDLERS = ["vite", "vitest", "tsup", "esbuild", "rollup", "webpack", "parcel", "rspack"]

/** Bundlers declared in any dependency block of a package manifest. */
export const bundlerDependencies = (manifest: unknown): ReadonlyArray<string> => {
  const blocks = manifest as Record<string, Record<string, string> | undefined>
  return DEPENDENCY_BLOCKS.flatMap((block) => Object.keys(blocks[block] ?? {})).filter((name) =>
    BUNDLERS.includes(name),
  )
}

// `bun build` is the bundler; `bunx tsc` and `bun test` are not.
const BUNDLER_INVOCATION = new RegExp(
  `(^|[\\s;&|])(bun\\s+build|${BUNDLERS.join("|")})([\\s;&|]|$)`,
  "m",
)

/** The `run` body of every `[tasks.<name>]` in a mise manifest, by task name. */
export const miseTasks = (manifest: string): ReadonlyArray<readonly [string, string]> => {
  const header = /^\[tasks\.(?:"([^"]+)"|([^\]]+))\]$/gm
  const headers = [...manifest.matchAll(header)]
  return headers.map((match, index) => {
    const end = headers[index + 1]?.index ?? manifest.length
    const body = manifest.slice(match.index + match[0].length, end)
    const triple = /run\s*=\s*"""([\s\S]*?)"""/.exec(body)
    const single = /run\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(body)
    return [match[1] ?? match[2] ?? "", triple?.[1] ?? single?.[1] ?? ""] as const
  })
}

/** Tasks whose command line invokes a bundler. */
export const bundlerTasks = (
  tasks: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<string> =>
  tasks.filter(([, command]) => BUNDLER_INVOCATION.test(command)).map(([name]) => name)

const MISE_TOML = readFileSync(`${REPO_ROOT}/mise.toml`, "utf8")

describe("ADR-0002 — a bundler", () => {
  test("names a bundler dependency in any block", () => {
    expect(bundlerDependencies({ devDependencies: { typescript: "6" } })).toEqual([])
    expect(
      bundlerDependencies({ devDependencies: { tsup: "8", esbuild: "0.2" }, dependencies: { rollup: "4" } }),
    ).toEqual(["rollup", "tsup", "esbuild"])
  })

  test("reads a mise task body, single-line or triple-quoted", () => {
    const manifest = [
      '[tools]',
      'bun = "1.3.14"',
      '[tasks.lint]',
      'run = "bunx oxlint src test"',
      '[tasks.build]',
      'run = """',
      'set -e',
      'bunx tsc -b tsconfig.build.json',
      '"""',
    ].join("\n")
    expect(miseTasks(manifest)).toEqual([
      ["lint", "bunx oxlint src test"],
      ["build", "\nset -e\nbunx tsc -b tsconfig.build.json\n"],
    ])
  })

  test("names a task that invokes a bundler, and spares `bunx tsc` and `bun test`", () => {
    expect(
      bundlerTasks([
        ["test", "bun test --isolate"],
        ["build", "bunx tsc -b tsconfig.build.json"],
      ]),
    ).toEqual([])
    expect(
      bundlerTasks([
        ["build", "bun build src/main.ts --compile --outfile foldcase"],
        ["web", "vite build"],
        ["pack", "tsup src/index.ts"],
      ]),
    ).toEqual(["build", "web", "pack"])
  })

  test("the repository declares no bundler and calls none", () => {
    expect(bundlerDependencies(PACKAGE_JSON)).toEqual([])
    expect(bundlerTasks(miseTasks(MISE_TOML))).toEqual([])
  })

  test("and the build task really is `tsc -b` — the rule is not vacuous", () => {
    const build = miseTasks(MISE_TOML).find(([name]) => name === "build")?.[1] ?? ""
    expect(build).toContain("tsc -b")
    expect(build).toContain("tsconfig.build.json")
  })
})

// ── 9. The published shape ───────────────────────────────────────────────────
//
// ADR-0002 › Amendment 1: the package is consumable from Node, Vite and Bun
// alike, in the same shape the Foldkit package itself publishes — every
// `exports` subpath a `{ "types", "import" }` pair into `dist/`, `bin` into
// `dist/`, `files` shipping the build output rather than the source, and
// `engines` naming Node.

interface PublishedManifest {
  readonly exports?: Record<string, unknown>
  readonly bin?: Record<string, string>
  readonly files?: ReadonlyArray<string>
  readonly engines?: Record<string, string>
}

/** `exports` subpaths that are not a `{ types, import }` pair pointing into `dist/`. */
export const malformedExports = (manifest: unknown): ReadonlyArray<string> =>
  Object.entries((manifest as PublishedManifest).exports ?? {})
    // `./package.json` is the one entry that is itself, not a build output.
    .filter(([subpath]) => subpath !== "./package.json")
    .filter(([, target]) => {
      const conditions = target as { types?: unknown; import?: unknown } | string
      if (typeof conditions !== "object" || conditions === null) {
        return true
      }
      const { import: imported, types } = conditions
      return (
        Object.keys(conditions).length !== 2 ||
        typeof types !== "string" ||
        typeof imported !== "string" ||
        !types.startsWith("./dist/") ||
        !types.endsWith(".d.ts") ||
        !imported.startsWith("./dist/") ||
        !imported.endsWith(".js")
      )
    })
    .map(([subpath]) => subpath)

/** `bin` entries that do not point at a built `dist/*.js`. */
export const unbuiltBins = (manifest: unknown): ReadonlyArray<string> =>
  Object.entries((manifest as PublishedManifest).bin ?? {})
    .filter(([, target]) => !target.startsWith("./dist/") || !target.endsWith(".js"))
    .map(([name]) => name)

describe("ADR-0002 — the published shape", () => {
  test("names an exports subpath that is not a types/import pair into dist/", () => {
    expect(
      malformedExports({
        exports: {
          ".": { types: "./dist/runner.d.ts", import: "./dist/runner.js" },
          "./package.json": "./package.json",
        },
      }),
    ).toEqual([])
    expect(
      malformedExports({
        exports: {
          "./source": "./src/runner.ts",
          "./partial": { import: "./dist/x.js" },
          "./extra": { types: "./dist/x.d.ts", import: "./dist/x.js", require: "./dist/x.cjs" },
          "./outside": { types: "./src/x.d.ts", import: "./src/x.js" },
        },
      }),
    ).toEqual(["./source", "./partial", "./extra", "./outside"])
  })

  test("names a bin that is not a build output", () => {
    expect(unbuiltBins({ bin: { foldcase: "./dist/main.js" } })).toEqual([])
    expect(unbuiltBins({ bin: { foldcase: "./src/main.ts", other: "./dist/x.mjs" } })).toEqual([
      "foldcase",
      "other",
    ])
  })

  test("package.json publishes the built shape", () => {
    const manifest = PACKAGE_JSON as PublishedManifest
    expect(malformedExports(PACKAGE_JSON)).toEqual([])
    expect(unbuiltBins(PACKAGE_JSON)).toEqual([])
    // `files` ships the build output, not the TypeScript sources.
    expect(manifest.files).toContain("dist")
    expect(manifest.files).not.toContain("src")
    // Node is a supported runtime now, and it has to say so.
    expect(manifest.engines?.node).toBeString()
  })
})
