// A directory-index module. Bun resolves `./lib` to this file; Node does not
// (ERR_UNSUPPORTED_DIR_IMPORT), which is what makes the sibling showcase load
// under the one loader and fail under the Node coverage collector.
export const answer = (): number => 42
