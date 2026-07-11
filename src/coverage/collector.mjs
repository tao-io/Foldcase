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
// previous take* (it resets on read). So per-Showcase attribution is direct: a
// throwaway take right before a `play` flushes setup/import coverage, and the
// take right after the `play` is exactly that play's coverage. Aggregate is the
// union of those per-Showcase takes, computed downstream.
//
// Protocol: argv = <rootDir> <showcaseFile...>; emits one JSON object
// ({ showcases: [{ id, scripts }] }) on stdout. Boundary code: uses
// process.stdout/stderr + node:inspector + JSON, kept out of the Effect domain
// lint scope via .oxlintrc ignore.

import { Session } from "node:inspector/promises"
import { pathToFileURL, fileURLToPath } from "node:url"

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

// Flush prior coverage, run the play, then read this play's coverage.
const runShowcase = async (showcase) => {
  await session.post("Profiler.takePreciseCoverage")
  try {
    await showcase.play()
  } catch {
    // A failing play still exercised code on the way to the assertion; pass/fail
    // is the Bun suite's authoritative job, not the collector's.
  }
  const { result } = await session.post("Profiler.takePreciseCoverage")
  return { id: showcase.id, scripts: result.filter((entry) => underRoot(entry.url)).map(toScript) }
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

// Sequential async folds — no imperative loop; each step awaits the prior.
const showcases = await files.reduce(
  (pending, file) =>
    pending.then(async (acc) => {
      const loaded = await loadShowcases(file)
      const reports = await loaded.reduce(
        (inner, showcase) => inner.then(async (list) => [...list, await runShowcase(showcase)]),
        Promise.resolve([]),
      )
      return [...acc, ...reports]
    }),
  Promise.resolve([]),
)

await session.post("Profiler.stopPreciseCoverage")
session.disconnect()

process.stdout.write(JSON.stringify({ showcases }))
