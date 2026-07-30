// Node-shell resolution policy for TypeScript showcase files.
//
// Node runs `*.showcase.ts` by stripping types, but it does not rewrite
// relative specifiers: a showcase that imports its component as `./Button`
// (extensionless, the usual TypeScript style) or as `./Button.js` (the NodeNext
// style, where the file on disk is `Button.ts`) fails to resolve. Bun resolves
// both itself, so this is a property of one runtime and belongs to that
// runtime's shell — not to the program.
//
// This module is the *policy*, kept free of `node:module` so it is testable on
// `bun test`. The Node shell (`src/main.ts`) installs it with `registerHooks`,
// the synchronous in-thread module-customization API, which takes effect for
// the `import()` the loader performs later in the same process and does not
// raise the `register()` deprecation (DEP0205).

/** The source extensions a bare relative specifier is retried with, in order. */
const SOURCE_EXTENSIONS: ReadonlyArray<string> = [".ts", ".tsx", ".mts", ".js", ".mjs"]

const HAS_EXTENSION = /\.[mc]?[jt]sx?$/

const isRelative = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../")

/**
 * The specifiers to retry after Node's own resolution failed: the source
 * extensions for a bare relative specifier, and the TypeScript sources a `.js`
 * specifier is written against. Empty for anything Node should already resolve.
 */
export const resolutionCandidates = (specifier: string): ReadonlyArray<string> => {
  if (!isRelative(specifier)) {
    return []
  }
  if (specifier.endsWith(".js")) {
    const stem = specifier.slice(0, -".js".length)
    return [`${stem}.ts`, `${stem}.tsx`]
  }
  return HAS_EXTENSION.test(specifier)
    ? []
    : SOURCE_EXTENSIONS.map((extension) => `${specifier}${extension}`)
}

/**
 * A `node:module` resolve hook: try Node's own resolution first, then each
 * candidate, and re-raise Node's original error if none of them resolve — so a
 * genuinely missing module still reports the specifier the author wrote.
 *
 * Generic over the hook's own types so this module needs no `node:module`
 * import (and stays loadable, and testable, under Bun).
 */
export const resolveTypeScriptSource = <Context, Resolved>(
  specifier: string,
  context: Context,
  nextResolve: (specifier: string, context: Context) => Resolved,
): Resolved => {
  try {
    return nextResolve(specifier, context)
  } catch (error) {
    for (const candidate of resolutionCandidates(specifier)) {
      try {
        return nextResolve(candidate, context)
      } catch {
        // try the next candidate
      }
    }
    throw error
  }
}
