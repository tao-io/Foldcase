// Shell policy for an optional platform peer that is not installed.
//
// `@effect/platform-node` and `@effect/platform-bun` are optional peers: a
// consumer needs only the one their bin runs. So a consumer who installs
// `foldcase` and `effect` alone gets a failed resolution the moment a shell
// reaches for its runtime — and, left alone, a raw loader stack trace on a
// first run. This module is the decision behind the nicer answer: is this cause
// the peer we just asked for, and what do we tell the user?
//
// It is the *policy*, free of any loader import, so it is testable on
// `bun test` under either runtime. The shells (`src/main.ts`,
// `src/main.bun.ts`) wrap their dynamic `import()` with it, print what it
// returns, and rethrow when it returns nothing.
//
// Node and Bun report the failure differently: Node throws a plain `Error`
// whose message quotes the package, Bun throws a `ResolveMessage` that also
// carries the specifier in a field. Both set `code` to `ERR_MODULE_NOT_FOUND`,
// which a consumer's own showcase file sets too when one of *its* imports is
// missing — so the code alone decides nothing. The specifier has to match.

/** The shape both runtimes' resolution failures are read through. */
interface ResolutionFailure {
  readonly code?: unknown
  readonly message?: unknown
  readonly specifier?: unknown
}

const read = (cause: unknown): ResolutionFailure =>
  typeof cause === "object" && cause !== null ? (cause as ResolutionFailure) : {}

/**
 * Whether `cause` is a failed resolution of exactly `peer`. The message is
 * matched on the quoted package name, so `@effect/platform-node-shared` is a
 * different package and a missing `./Button` is not this at all.
 */
const namesPeer = (cause: unknown, peer: string): boolean => {
  const { code, message, specifier } = read(cause)
  if (code !== "ERR_MODULE_NOT_FOUND") {
    return false
  }
  return specifier === peer || (typeof message === "string" && message.includes(`'${peer}'`))
}

/**
 * What to print when a bin's optional platform peer is missing: the package,
 * the command that installs it, and `otherBin`, the bin that runs on the other
 * runtime and so needs the other package. `undefined` for any other cause —
 * which the caller must rethrow untouched.
 */
export const missingPeerNotice = (
  cause: unknown,
  peer: string,
  otherBin: string,
): string | undefined =>
  namesPeer(cause, peer)
    ? [
        `foldcase: this bin needs the optional peer ${peer}, which is not installed.`,
        `  install it:  npm i -D ${peer}`,
        `  or run the other bin instead:  ${otherBin}`,
      ].join("\n")
    : undefined
