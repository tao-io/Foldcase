// foldcase coverage collector — a Node instrument, NOT domain code.
//
// `foldcase test --coverage` spawns this under Node because Bun exposes no
// programmatic V8 precise coverage (node:inspector's Coverage domain is
// unsupported, NODE_V8_COVERAGE is ignored, and bun:jsc.codeCoverageForFile is
// broken). Node's inspector Session gives real, precise, per-function coverage,
// and Node's native type-stripping lets it `import()` the `.showcase.ts` files
// directly.
//
// Node's `Profiler.takePreciseCoverage` returns coverage collected *since the
// previous take* (it resets on read), and a since-take snapshot omits functions
// that did not run — so a delta alone can't see the *denominator* (a file's
// uncalled functions/lines). Two phases solve it:
//   1. Aggregate: run every play, then ONE take → the full cumulative snapshot,
//      which lists an executed file's uncalled functions (count 0) too. This is
//      the denominator + overall coverage (`total`).
//   2. Per-Showcase: re-run each play between takes; the take after a play is
//      exactly that play's coverage — the per-Showcase numerator (`showcases`).
//
// Protocol: argv = <rootDir> <showcaseFile...>; emits one JSON object
// ({ showcases: [{ id, scripts }], total: [scripts] }) on stdout. Boundary code:
// uses process.stdout/stderr + node:inspector + JSON, kept out of the Effect
// domain lint scope via .oxlintrc ignore.

import { register } from "node:module"
import { Session } from "node:inspector/promises"
import { pathToFileURL, fileURLToPath } from "node:url"

// Node's native type-stripping runs `.ts` files but, unlike Bun/tsx, does NOT
// add extensions to relative imports — realistic showcases import components as
// `./Button` (no extension). Register a resolve hook that retries a failed
// relative specifier with the usual source extensions so those imports load.
const resolverHook = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../")
    if (relative && !/\\.[mc]?[jt]sx?$/.test(specifier)) {
      for (const ext of [".ts", ".tsx", ".mts", ".js", ".mjs"]) {
        try {
          return await next(specifier + ext, context)
        } catch {
          // try the next extension
        }
      }
    }
    throw error
  }
}
`
register(`data:text/javascript,${encodeURIComponent(resolverHook)}`)

const [rootDir, ...files] = process.argv.slice(2)
const rootUrl = pathToFileURL(rootDir).href

// Keep only file:// scripts under the target root, excluding dependencies.
const underRoot = (url) => url.startsWith(rootUrl) && !url.includes("/node_modules/")

// Convert a V8 script coverage entry to our { path, functions } shape.
const toScript = (entry) => ({
  path: fileURLToPath(entry.url),
  functions: entry.functions.map((fn) => ({
    functionName: fn.functionName,
    isBlockCoverage: fn.isBlockCoverage,
    ranges: fn.ranges.map((range) => ({
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      count: range.count,
    })),
  })),
})

const session = new Session()
session.connect()
await session.post("Profiler.enable")
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
const take = async () => (await session.post("Profiler.takePreciseCoverage")).result

// A failing play still exercised code on the way to the assertion; pass/fail is
// the Bun suite's authoritative job, not the collector's.
const play = async (showcase) => {
  try {
    await showcase.play()
  } catch {
    // swallow assertion throws — coverage, not correctness, is the job here
  }
}

// Import one showcase module and flatten its Showcases (best-effort per file).
const loadShowcases = async (file) => {
  try {
    const module = await import(pathToFileURL(file).href)
    return Array.isArray(module.showcases) ? module.showcases : []
  } catch (error) {
    process.stderr.write(`foldcase collector: skipped ${file}: ${String(error)}\n`)
    return []
  }
}

// Sequential async fold — no imperative loop; each step awaits the prior.
const sequence = (items, step) =>
  items.reduce((pending, item) => pending.then((acc) => step(acc, item)), Promise.resolve([]))

const showcases = await sequence(files, async (acc, file) => [
  ...acc,
  ...(await loadShowcases(file)),
])

// Phase 1 — aggregate: run every play, then one cumulative take (denominators).
await sequence(showcases, async (_, showcase) => [await play(showcase)])
const total = (await take()).filter((entry) => underRoot(entry.url)).map(toScript)

// Phase 2 — per-Showcase: a flush take, the play, then the play's own coverage.
const attributed = await sequence(showcases, async (acc, showcase) => {
  await take()
  await play(showcase)
  const scripts = (await take()).filter((entry) => underRoot(entry.url)).map(toScript)
  return [...acc, { id: showcase.id, scripts }]
})

await session.post("Profiler.stopPreciseCoverage")
session.disconnect()

process.stdout.write(JSON.stringify({ showcases: attributed, total }))
