// ADR-0001 › Enforcement — one definition, many surfaces.
//
// A Showcase is declared once, in src/runner.ts, and every surface (the test
// runner, the MCP catalog and tools, the docs generator, coverage, a future
// lab) is a projection of that record. This gate fails on the four mechanical
// ways that can rot: a second shape, a second loader, a surface that parses
// source or crawls a DOM to recover what the record already says, and an
// `exports` entry that points at nothing.
//
// It is deliberately zero-dependency — `bun:test` and `node:fs` only, importing
// no project code — so it keeps working when the project itself does not.

import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/** Where the single definition lives. Everything else derives from it. */
const DEFINITION = "src/runner.ts"

/**
 * The two ADR gates. They quote the very patterns they forbid, so they are not
 * themselves subject to the scan — the fence is not a surface.
 */
const GATES = new Set(["test/stack.test.ts", "test/surface-derivation.test.ts"])

const IGNORED = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"])

const walk = (root: string, prefix: string): ReadonlyArray<string> =>
  readdirSync(root).flatMap((entry) => {
    if (IGNORED.has(entry)) {
      return []
    }
    const absolute = `${root}/${entry}`
    const relative = `${prefix}/${entry}`
    return statSync(absolute).isDirectory() ? walk(absolute, relative) : [relative]
  })

/** Every source file of the project: src/ and test/, minus the gates themselves. */
const SOURCES = [...walk(`${REPO_ROOT}/src`, "src"), ...walk(`${REPO_ROOT}/test`, "test")]
  .filter((file) => /\.(ts|mjs)$/.test(file))
  .filter((file) => !GATES.has(file))

const read = (file: string): string => readFileSync(`${REPO_ROOT}/${file}`, "utf8")

// ── Reading source as code, not as prose ─────────────────────────────────────

/**
 * The source with its comments removed, so a rule reads what the module *does*
 * and not what its documentation talks about. String and template literals are
 * preserved: a path is code.
 */
export const codeOf = (source: string): string => {
  let code = ""
  let index = 0
  let quote: string | undefined
  while (index < source.length) {
    const character = source[index] as string
    const next = source[index + 1]
    if (quote !== undefined) {
      code += character
      if (character === "\\") {
        code += next ?? ""
        index += 2
        continue
      }
      if (character === quote) {
        quote = undefined
      }
      index += 1
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
      code += character
      index += 1
      continue
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1
      }
      continue
    }
    if (character === "/" && next === "*") {
      index += 2
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1
      }
      index += 2
      continue
    }
    code += character
    index += 1
  }
  return code
}

describe("reading source as code", () => {
  test("drops line and block comments and keeps string literals", () => {
    expect(codeOf('const a = 1 // import("./x.showcase.ts")\nconst b = 2')).toBe(
      "const a = 1 \nconst b = 2",
    )
    expect(codeOf("/** doc\n * interface Showcase { id: string; play: () => void }\n */\nconst a = 1")).toBe(
      "\nconst a = 1",
    )
    expect(codeOf('const suffix = ".showcase.ts" // the one suffix')).toBe(
      'const suffix = ".showcase.ts" ',
    )
  })
})

// ── 1. A second shape ────────────────────────────────────────────────────────

const DECLARATION_HEAD = /\b(?:interface\s+\w+[^;{]*|type\s+\w+\s*=[^;{]*)\{/g

/** The `{ … }` body of every interface and object type alias in a module. */
const declarationBodies = (code: string): ReadonlyArray<string> => {
  const bodies: Array<string> = []
  for (const match of code.matchAll(DECLARATION_HEAD)) {
    let depth = 0
    let index = (match.index ?? 0) + match[0].length - 1
    const start = index
    while (index < code.length) {
      if (code[index] === "{") {
        depth += 1
      }
      if (code[index] === "}") {
        depth -= 1
        if (depth === 0) {
          break
        }
      }
      index += 1
    }
    bodies.push(code.slice(start + 1, index))
  }
  return bodies
}

const declaresMember = (body: string, member: string): boolean =>
  new RegExp(`(^|[\\s;,])(readonly\\s+)?${member}\\s*\\??\\s*:`).test(body)

/**
 * A declaration that pairs an `id` with a `play` is the Showcase record wearing
 * another name — the "local widening" ADR-0001 rejects.
 */
export const showcaseShapeDeclarations = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files.filter((file) =>
    declarationBodies(codeOf(source(file))).some(
      (body) => declaresMember(body, "id") && declaresMember(body, "play"),
    ),
  )

describe("ADR-0001 — a second shape", () => {
  test("names an interface or type alias that pairs id with play, and nothing else", () => {
    const sources: Record<string, string> = {
      "shape.ts": "export interface Showcase {\n readonly id: string\n readonly play: () => void\n}",
      "alias.ts": "type Fake = { id: string; play: () => void }",
      "nested.ts": "interface Wrapper { readonly entry: { id: string; play: () => void } }",
      "service.ts": "export interface CatalogShape {\n readonly list: () => void\n}",
      "report.ts": "interface Ratio { covered: number; total: number }",
      "id-only.ts": "interface Summary { readonly id: string; readonly hasSchema: boolean }",
      "commented.ts": "// interface Showcase { id: string; play: () => void }\nexport const a = 1",
      "value.ts": 'export const showcases = [{ id: "a", play: () => {} }]',
    }
    expect(showcaseShapeDeclarations(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "shape.ts",
      "alias.ts",
      "nested.ts",
    ])
  })

  test("only src/runner.ts declares it", () => {
    const elsewhere = SOURCES.filter((file) => file !== DEFINITION)
    expect(showcaseShapeDeclarations(elsewhere, read)).toEqual([])
    expect(showcaseShapeDeclarations([DEFINITION], read)).toEqual([DEFINITION])
  })
})

// ── 2. A second loader ───────────────────────────────────────────────────────

/** The one loader. Every surface obtains its catalog through this module. */
const LOADER = "src/cli.ts"

/** The shipped modules — sources under src/, excluding their co-located tests. */
const MODULES = SOURCES.filter((file) => file.startsWith("src/") && !file.endsWith(".test.ts"))

/** The projections ADR-0001 names, plus the lab directory it reserves. */
const SURFACE_DIRECTORIES = ["src/mcp/", "src/docs/", "src/coverage/", "src/lab/"]

/**
 * The single module that loads showcase files outside {@link LOADER}, and why.
 *
 * `--coverage` measures V8 precise coverage, which Bun cannot produce, so the
 * collector runs in a spawned Node process under the inspector (ADR-0002 › The
 * one declared exception). Across that process boundary it cannot call the
 * Effect-based loader, so it imports the files it is handed — the file list
 * still comes from the one loader, but the import does not.
 *
 * ADR-0001 › Amendment 1 settles it: a `play` is a closure, so a loaded catalog
 * cannot cross a process boundary as data, and V8 precise coverage is only
 * meaningful inside the instrumented process. The exception is structural, and
 * it is bounded here — one entry, and the collector attributes coverage to the
 * declared Showcases rather than deciding which ones exist.
 */
const DECLARED_SECOND_LOADER: ReadonlyArray<string> = ["src/coverage/collector.mjs"]

const DYNAMIC_IMPORT = /(^|[^.\w])import\s*\(/g

/**
 * A specifier that is written out in full: a package this module always meant
 * to import. A shell asks for its optional `@effect/platform-*` peer that way —
 * dynamically, so a consumer who never installed it gets an explanation rather
 * than a loader stack trace — and that is a binding, not a load. Loading is
 * importing a path the module was *handed*, which is what this rule fences.
 */
const CONSTANT_SPECIFIER = /^\s*(?:"[^"]*"|'[^']*'|`[^`$]*`)\s*\)/

/** Modules that import a path they were handed at runtime — that is, that load. */
export const dynamicImporters = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files.filter((file) => {
    const code = codeOf(source(file))
    return [...code.matchAll(DYNAMIC_IMPORT)].some(
      (match) => !CONSTANT_SPECIFIER.test(code.slice(match.index + match[0].length)),
    )
  })

/** Surface modules that name a showcase file in code — that is, that discover. */
export const showcaseFileReaders = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files
    .filter((file) => SURFACE_DIRECTORIES.some((directory) => file.startsWith(directory)))
    .filter((file) => codeOf(source(file)).includes(".showcase.ts"))

describe("ADR-0001 — a second loader", () => {
  test("names a module that imports a path, and spares a named package, prose and a static import", () => {
    const sources: Record<string, string> = {
      "loader.ts": "const m = await import(path)",
      "typed.ts": "const m = Effect.tryPromise({ try: () => import(path) })",
      "interpolated.ts": "const m = await import(`${directory}/entry.ts`)",
      "prose.ts": "// `import()` resolves a relative path against the importer\nexport const a = 1",
      "static.ts": 'import * as Effect from "effect/Effect"\nexport const meta = import.meta.dir',
      "shell.ts": 'const platform = await import("@effect/platform-node")',
      "mixed.ts": 'await import("@effect/platform-bun")\nconst m = await import(path)',
    }
    expect(dynamicImporters(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "loader.ts",
      "typed.ts",
      "interpolated.ts",
      "mixed.ts",
    ])
  })

  test("names a surface that reaches for showcase files itself", () => {
    const sources: Record<string, string> = {
      "src/mcp/catalog.ts": '// discovers `*.showcase.ts` from disk\nexport const a = 1',
      "src/docs/crawl.ts": 'const files = entries.filter((e) => e.endsWith(".showcase.ts"))',
      "src/main.ts": 'Console.error("no *.showcase.ts found")',
    }
    expect(showcaseFileReaders(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "src/docs/crawl.ts",
    ])
  })

  test("src/cli.ts is the only loader, save the one declared exception", () => {
    const elsewhere = MODULES.filter(
      (file) => file !== LOADER && !DECLARED_SECOND_LOADER.includes(file),
    )
    expect(dynamicImporters(elsewhere, read)).toEqual([])
    expect(dynamicImporters([LOADER], read)).toEqual([LOADER])
  })

  test("the exception is exactly one module, and it is really there", () => {
    expect(DECLARED_SECOND_LOADER).toEqual(["src/coverage/collector.mjs"])
    expect(MODULES).toContain("src/coverage/collector.mjs")
  })

  test("no surface reads showcase files itself", () => {
    expect(showcaseFileReaders(MODULES, read)).toEqual([])
  })
})

// ── 3. A surface parser ──────────────────────────────────────────────────────

/**
 * Recovering a component fact from source or from a rendered DOM is the
 * Storybook-addon move ADR-0001 exists to prevent. A surface asks the
 * declaration; it does not parse, glob or query for the answer.
 */
const PARSER_PACKAGES = [
  "oxc-parser",
  "@babel/parser",
  "acorn",
  "espree",
  "react-docgen",
  "typescript",
  "fast-glob",
  "globby",
  "glob",
]

// A DOM crawl needs a query API, so the query names are the tell. Plain
// `document.` is not: `src/docs/schema-table.ts` names its JSON Schema document
// `document`, and a local binding is not the DOM.
const DOM_QUERIES = [
  "querySelector",
  "getElementsBy",
  "innerHTML",
  "outerHTML",
  "globalThis.document",
  "window.document",
]

const importsPackage = (code: string, name: string): boolean =>
  new RegExp(`(from|import|require)\\s*\\(?\\s*["'\`]${name.replace(/[/@.]/g, "\\$&")}`).test(code)

/** Every parser import or DOM query found in a module, as `file → offender`. */
export const surfaceParsers = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files.flatMap((file) => {
    const code = codeOf(source(file))
    return [
      ...PARSER_PACKAGES.filter((name) => importsPackage(code, name)),
      ...DOM_QUERIES.filter((query) => code.includes(query)),
    ].map((offender) => `${file} → ${offender}`)
  })

describe("ADR-0001 — a surface parser", () => {
  test("names a source parser, a glob library and a DOM query", () => {
    const sources: Record<string, string> = {
      "clean.ts": 'import * as Schema from "effect/Schema"\nexport const a = 1',
      "parse.ts": 'import { parseSync } from "oxc-parser"',
      "glob.ts": 'import glob from "fast-glob"',
      "dom.ts": "const canvas = globalThis.document.querySelector('#root')",
      "shadow.ts": "const root = resolveRef(document, document.schema)",
      "prose.ts": "// a DOM crawl would use document.querySelector\nexport const a = 1",
    }
    expect(surfaceParsers(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "parse.ts → oxc-parser",
      "glob.ts → fast-glob",
      "dom.ts → querySelector",
      "dom.ts → globalThis.document",
    ])
  })

  test("no module parses or queries for what the declaration already says", () => {
    expect(surfaceParsers(MODULES, read)).toEqual([])
  })
})

// ── 4. Exports drift ─────────────────────────────────────────────────
//
// A surface can never be published under a path that does not derive, because
// the path is not there. Since ADR-0002 › Amendment 1 the published paths are
// build outputs (`dist/*.js` + `dist/*.d.ts`), and that turns the obvious form
// of this gate into a trap: checking only the built file would make the suite
// pass on a machine that has run `mise run build` and fail on a clean checkout,
// which is the same as not checking at all.
//
// So the gate checks the *mapping* instead, and the build output on top of it:
//
//   1. always — every entry point maps back to a source file under `src/` that
//      exists (`./dist/mcp/server.js` → `./src/mcp/server.ts`). This is the
//      clause that actually prevents drift, and it holds on a clean checkout.
//   2. when `dist/` is present — the built file is there too, so a stale or
//      partial build cannot be published.
//
// A published path that is neither a build output nor `package.json` has no
// source to map to, and is reported by the first clause.

const entryPoints = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") {
    return [value]
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(entryPoints)
  }
  return []
}

/** Every published entry point: `exports` (through condition maps) plus `bin`. */
export const publishedEntryPoints = (manifest: unknown): ReadonlyArray<string> => {
  const { bin, exports } = manifest as { bin?: unknown; exports?: unknown }
  return [...entryPoints(exports), ...entryPoints(bin)]
}

/**
 * The source file a published entry point is built from, if it is a build
 * output. `./package.json` is published as itself, so it is its own source.
 */
export const entryPointSource = (entry: string): string | undefined => {
  if (entry === "./package.json") {
    return entry
  }
  if (!entry.startsWith("./dist/")) {
    return undefined
  }
  const stem = entry.replace(/^\.\/dist\//, "./src/")
  if (stem.endsWith(".d.ts")) {
    return `${stem.slice(0, -".d.ts".length)}.ts`
  }
  if (stem.endsWith(".js")) {
    return `${stem.slice(0, -".js".length)}.ts`
  }
  return undefined
}

/**
 * Entry points with no source behind them: either not a build output at all, or
 * a build output whose `src/` original has been renamed or deleted. Checkable
 * on a clean checkout, which is the point.
 */
export const sourcelessEntryPoints = (
  manifest: unknown,
  exists: (path: string) => boolean,
): ReadonlyArray<string> =>
  publishedEntryPoints(manifest).filter((entry) => {
    const source = entryPointSource(entry)
    return source === undefined || !exists(source)
  })

/** Entry points missing from an existing build — a stale or partial `dist/`. */
export const unbuiltEntryPoints = (
  manifest: unknown,
  exists: (path: string) => boolean,
): ReadonlyArray<string> => publishedEntryPoints(manifest).filter((entry) => !exists(entry))

const MANIFEST: unknown = JSON.parse(read("package.json"))

const onDisk = (path: string): boolean => existsSync(`${REPO_ROOT}/${path}`)

describe("ADR-0001 — exports drift", () => {
  test("maps a build output back to the source it is compiled from", () => {
    expect(entryPointSource("./dist/runner.js")).toBe("./src/runner.ts")
    expect(entryPointSource("./dist/mcp/server.d.ts")).toBe("./src/mcp/server.ts")
    expect(entryPointSource("./dist/main.bun.js")).toBe("./src/main.bun.ts")
    expect(entryPointSource("./package.json")).toBe("./package.json")
    // Not a build output: publishing source, or a path from nowhere.
    expect(entryPointSource("./src/runner.ts")).toBeUndefined()
    expect(entryPointSource("./dist/runner.wasm")).toBeUndefined()
  })

  test("names an entry point with no source behind it, through condition maps too", () => {
    const present = new Set(["./src/runner.ts", "./src/main.ts", "./package.json"])
    const exists = (path: string): boolean => present.has(path)
    expect(
      sourcelessEntryPoints(
        {
          exports: { ".": { types: "./dist/runner.d.ts", import: "./dist/runner.js" } },
          bin: { foldcase: "./dist/main.js" },
        },
        exists,
      ),
    ).toEqual([])
    expect(
      sourcelessEntryPoints(
        {
          exports: {
            ".": { types: "./dist/runner.d.ts", import: "./dist/runner.js" },
            "./lab": { types: "./dist/lab/index.d.ts", import: "./dist/lab/index.js" },
            "./raw": "./src/runner.ts",

          },
          bin: { foldcase: "./dist/gone.js" },
        },
        exists,
      ),
    ).toEqual([
      "./dist/lab/index.d.ts",
      "./dist/lab/index.js",
      // Publishing `.ts` source is exactly what Amendment 1 stopped doing.
      "./src/runner.ts",
      "./dist/gone.js",
    ])
  })

  test("names an entry point an existing build did not produce", () => {
    const built = new Set(["./dist/runner.js", "./package.json"])
    expect(
      unbuiltEntryPoints(
        { exports: { ".": { types: "./dist/runner.d.ts", import: "./dist/runner.js" } } },
        (path) => built.has(path),
      ),
    ).toEqual(["./dist/runner.d.ts"])
  })

  test("every published entry point derives from a source that exists", () => {
    expect(sourcelessEntryPoints(MANIFEST, onDisk)).toEqual([])
  })

  test("and — when there is a build — the build really produced them", () => {
    // Conditional on purpose: a clean checkout has no `dist/`, and a gate that
    // demanded one would fail for everyone who has not built yet. When a build
    // is present it must be complete.
    if (!onDisk("dist")) {
      return
    }
    expect(unbuiltEntryPoints(MANIFEST, onDisk)).toEqual([])
  })
})

// ── The positive half: every surface derives from the definition ─────────────

const SHOWCASE_IDENTIFIER = /\bShowcase\b/
// NodeNext-style relative specifiers carry a `.js` extension even though the
// file on disk is `runner.ts` (ADR-0002 › Amendment 1: the package is built by
// `tsc`), so the extension is optional here.
const IMPORTS_FROM_RUNNER = /from\s+["']\.{1,2}(?:\/\.\.)*\/runner(?:\.js)?["']/

/**
 * The code with the *contents* of its string and template literals emptied,
 * quotes and all else kept. The loader rule below needs a path to stay code, so
 * {@link codeOf} keeps literals; this rule needs the opposite, because a string
 * cannot declare a type. `src/init.ts` carries the paragraph `foldcase init`
 * writes into a consumer's `AGENTS.md`, which names Showcases the way the
 * README does — text the tool hands over, not a record it declares. An
 * interpolation goes with the literal holding it: a type cannot appear in one,
 * so nothing this rule looks for can hide there.
 */
export const withoutText = (code: string): string => {
  let stripped = ""
  let index = 0
  let quote: string | undefined
  while (index < code.length) {
    const character = code[index] as string
    if (quote === undefined) {
      stripped += character
      if (character === '"' || character === "'" || character === "`") {
        quote = character
      }
      index += 1
      continue
    }
    if (character === "\\") {
      index += 2
      continue
    }
    if (character === quote) {
      stripped += character
      quote = undefined
    }
    index += 1
  }
  return stripped
}

/**
 * Modules that name a `Showcase` in *code* without importing the type from
 * {@link DEFINITION}. Naming the record while sourcing it from somewhere else
 * is how a private, drifting copy starts.
 */
export const undeclaredShowcaseUsers = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files.filter((file) => {
    const code = codeOf(source(file))
    return SHOWCASE_IDENTIFIER.test(withoutText(code)) && !IMPORTS_FROM_RUNNER.test(code)
  })

describe("ADR-0001 — every surface derives from the definition", () => {
  test("names a module that uses Showcase without importing it from the runner", () => {
    const sources: Record<string, string> = {
      "src/cli.ts": 'import { type Showcase } from "./runner"\nconst a: Showcase = x',
      "src/mcp/catalog.ts": 'import { type Showcase } from "../runner"\nconst a: Showcase = x',
      "src/rogue.ts": "const a: Showcase = x",
      "src/coverage/report.ts": "class ShowcaseCoverage {}",
      "src/prose.ts": "// per-Showcase attribution\nexport const a = 1",
      "src/init.ts": 'export const section = ["- add a Showcase for it"].join("\\n")',
    }
    expect(undeclaredShowcaseUsers(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "src/rogue.ts",
    ])
  })

  test("empties a literal and keeps the code around it", () => {
    expect(withoutText('const a = "text" + `more ${x}`')).toBe("const a = \"\" + ``")
    // An escaped quote does not end the literal, so what follows is still text.
    expect(withoutText('const a = "he said \\"Showcase\\"" ; const b: Showcase = x')).toBe(
      'const a = "" ; const b: Showcase = x',
    )
  })

  test("every module that names a Showcase takes it from src/runner.ts", () => {
    const elsewhere = MODULES.filter((file) => file !== DEFINITION)
    expect(undeclaredShowcaseUsers(elsewhere, read)).toEqual([])
  })

  test("and the surfaces really do name one — the rule is not vacuous", () => {
    const derivers = MODULES.filter(
      (file) => file !== DEFINITION && IMPORTS_FROM_RUNNER.test(codeOf(read(file))),
    )
    expect(derivers.toSorted()).toEqual([
      "src/cli.ts",
      "src/coverage/collect.ts",
      "src/coverage/report.ts",
      "src/docs/generate.ts",
      "src/mcp/catalog.ts",
      "src/mcp/tools.ts",
      "src/program.ts",
      // The `--json` documents: `TestDocument` wraps the runner's `SuiteReport`,
      // so the entry point a consumer decodes with derives from the definition
      // like every other surface.
      "src/reports.ts",
    ])
  })
})
