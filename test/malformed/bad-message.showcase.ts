// An untrusted `*.showcase.ts` whose `message` is not an Effect Schema. Lives
// outside test/fixtures so the discovery-based suites never load it; the loader
// must reject it (a non-Schema message would defect Schema.toJsonSchemaDocument).
export const showcases = [{ id: "bad/message", play: () => {}, message: "not a schema" }]
