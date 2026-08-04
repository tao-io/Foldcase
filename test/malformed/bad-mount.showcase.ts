// An untrusted `*.showcase.ts` whose `mount` is not a function. Lives outside
// test/fixtures so the discovery-based suites never load it; the loader must
// reject it (the lab calls `mount` to draw, so a non-callable would defect).
export const showcases = [{ id: "bad/mount", play: () => {}, mount: "not a function" }]
