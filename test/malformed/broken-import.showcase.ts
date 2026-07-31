// A `*.showcase.ts` that cannot be imported at all: the module it depends on
// does not exist, so evaluating the file throws before it can export anything.
// Lives outside `test/fixtures` so the discovery-based suites never load it;
// its job is to prove that one unloadable file is reported, not fatal.
// @ts-expect-error -- the missing module is the point of the fixture.
import { missing } from "./there-is-no-such-module"

export const showcases = [{ id: "broken/import", play: () => missing() }]
