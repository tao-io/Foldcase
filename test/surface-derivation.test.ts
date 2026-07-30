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
 * ADR-0001's Enforcement section does not name this exception; it should be
 * amended to, or the collector should be given the loaded catalog rather than
 * the file paths. Until then it is declared here, and pinned to one entry.
 */
const DECLARED_SECOND_LOADER: ReadonlyArray<string> = ["src/coverage/collector.mjs"]

const DYNAMIC_IMPORT = /(^|[^.\w])import\s*\(/

/** Modules that dynamically import a module at runtime — that is, that load. */
export const dynamicImporters = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> => files.filter((file) => DYNAMIC_IMPORT.test(codeOf(source(file))))

/** Surface modules that name a showcase file in code — that is, that discover. */
export const showcaseFileReaders = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files
    .filter((file) => SURFACE_DIRECTORIES.some((directory) => file.startsWith(directory)))
    .filter((file) => codeOf(source(file)).includes(".showcase.ts"))

describe("ADR-0001 — a second loader", () => {
  test("names a module that dynamically imports, and ignores one that only mentions it", () => {
    const sources: Record<string, string> = {
      "loader.ts": "const m = await import(path)",
      "typed.ts": "const m = Effect.tryPromise({ try: () => import(path) })",
      "prose.ts": "// `import()` resolves a relative path against the importer\nexport const a = 1",
      "static.ts": 'import * as Effect from "effect/Effect"\nexport const meta = import.meta.dir',
    }
    expect(dynamicImporters(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "loader.ts",
      "typed.ts",
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

// ── 4. Exports drift ─────────────────────────────────────────────────────────

const entryPoints = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") {
    return [value]
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(entryPoints)
  }
  return []
}

/**
 * Every published entry point that resolves to nothing. A surface can never be
 * published under a path that does not derive, because the path is not there.
 */
export const missingEntryPoints = (
  manifest: unknown,
  exists: (path: string) => boolean,
): ReadonlyArray<string> => {
  const { bin, exports } = manifest as { bin?: unknown; exports?: unknown }
  return [...entryPoints(exports), ...entryPoints(bin)].filter((entry) => !exists(entry))
}

const MANIFEST: unknown = JSON.parse(read("package.json"))

describe("ADR-0001 — exports drift", () => {
  test("names an entry point that resolves to nothing, through condition maps too", () => {
    const present = new Set(["./src/runner.ts", "./src/main.ts"])
    const exists = (path: string): boolean => present.has(path)
    expect(
      missingEntryPoints(
        { exports: { ".": "./src/runner.ts" }, bin: { foldcase: "./src/main.ts" } },
        exists,
      ),
    ).toEqual([])
    expect(
      missingEntryPoints(
        {
          exports: {
            ".": "./src/runner.ts",
            "./lab": { bun: "./src/lab/index.ts", default: "./src/lab/index.js" },
          },
          bin: { foldcase: "./src/gone.ts" },
        },
        exists,
      ),
    ).toEqual(["./src/lab/index.ts", "./src/lab/index.js", "./src/gone.ts"])
  })

  test("every published entry point is a file that exists", () => {
    expect(missingEntryPoints(MANIFEST, (path) => existsSync(`${REPO_ROOT}/${path}`))).toEqual([])
  })
})

// ── The positive half: every surface derives from the definition ─────────────

const SHOWCASE_IDENTIFIER = /\bShowcase\b/
const IMPORTS_FROM_RUNNER = /from\s+["']\.{1,2}(?:\/\.\.)*\/runner["']/

/**
 * Modules that name a `Showcase` without importing the type from
 * {@link DEFINITION}. Naming the record while sourcing it from somewhere else
 * is how a private, drifting copy starts.
 */
export const undeclaredShowcaseUsers = (
  files: ReadonlyArray<string>,
  source: (file: string) => string,
): ReadonlyArray<string> =>
  files.filter((file) => {
    const code = codeOf(source(file))
    return SHOWCASE_IDENTIFIER.test(code) && !IMPORTS_FROM_RUNNER.test(code)
  })

describe("ADR-0001 — every surface derives from the definition", () => {
  test("names a module that uses Showcase without importing it from the runner", () => {
    const sources: Record<string, string> = {
      "src/cli.ts": 'import { type Showcase } from "./runner"\nconst a: Showcase = x',
      "src/mcp/catalog.ts": 'import { type Showcase } from "../runner"\nconst a: Showcase = x',
      "src/rogue.ts": "const a: Showcase = x",
      "src/coverage/report.ts": "class ShowcaseCoverage {}",
      "src/prose.ts": "// per-Showcase attribution\nexport const a = 1",
    }
    expect(undeclaredShowcaseUsers(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([
      "src/rogue.ts",
    ])
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
      "src/main.ts",
      "src/mcp/catalog.ts",
      "src/mcp/tools.ts",
    ])
  })
})
