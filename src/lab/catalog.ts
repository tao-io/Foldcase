import * as Arr from "effect/Array"
import * as Order from "effect/Order"
import * as Schema from "effect/Schema"

import { type CatalogLoad, ShowcaseModuleError } from "../cli.js"
import { componentName } from "../docs/generate.js"
import type { Showcase } from "../runner.js"

/**
 * One Showcase as the lab sees it: what to call it, which component it belongs
 * to, where it was declared, and which of the optional seams it carries.
 *
 * The three flags are the lab's whole reading of the record. `hasMount` says
 * whether there is anything to draw; the two Schema flags say which panel is
 * worth opening beside the canvas. They are read separately, as the MCP listing
 * reads its own pair, because a Showcase declares any, all or none of them.
 *
 * `file` is absent for a catalog no file backs — one held in memory — since the
 * loader carries the file beside the record and has none to carry there.
 */
export class LabEntry extends Schema.Class<LabEntry>("LabEntry")({
  id: Schema.String,
  component: Schema.String,
  file: Schema.optional(Schema.String),
  hasMount: Schema.Boolean,
  hasMessageSchema: Schema.Boolean,
  hasModelSchema: Schema.Boolean,
}) {}

/**
 * One component and the Showcases under it, in id order.
 *
 * A component is an id namespace — everything before the last `/` — which is
 * the rule `src/docs/generate.ts` already runs on and the one an MCP
 * `id_prefix` filters by (ADR-0001 › Amendment 3). The lab reads it from there
 * rather than declaring a second notion of what a component is.
 */
export class LabComponent extends Schema.Class<LabComponent>("LabComponent")({
  component: Schema.String,
  entries: Schema.Array(LabEntry),
}) {}

/**
 * The whole document the lab shell renders and an agent decodes: every
 * component, the files that would not load, and how many Showcases the load
 * produced in all.
 *
 * The failures ride along because a file that will not load is data, not a
 * failure of the run (ADR-0001 › Amendment 2), and the lab is the surface that
 * can show them next to the gallery: a component missing from the list is a
 * question, and the file that would not load is the answer. Such a file never
 * declared an id, so it counts for nothing in `total`.
 */
export class LabCatalog extends Schema.Class<LabCatalog>("LabCatalog")({
  components: Schema.Array(LabComponent),
  failures: Schema.Array(ShowcaseModuleError),
  total: Schema.Number,
}) {}

const byId = Order.mapInput(Order.String, (entry: LabEntry) => entry.id)
const byComponent = Order.mapInput(Order.String, (group: LabComponent) => group.component)

const entryOf = (showcase: Showcase, file: string | undefined): LabEntry =>
  new LabEntry({
    id: showcase.id,
    component: componentName(showcase.id),
    file,
    hasMount: showcase.mount !== undefined,
    hasMessageSchema: showcase.message !== undefined,
    hasModelSchema: showcase.model !== undefined,
  })

/**
 * Project a loaded catalog into the lab's document.
 *
 * Pure, and deliberately so: it takes the {@link CatalogLoad} the one loader
 * already produced, reads only the record, and reaches for no disk, no DOM and
 * no framework. Components and their entries come out in id order, so two runs
 * over the same catalog produce the same document and an agent diffing them
 * sees no churn.
 */
export const labCatalogOf = (load: CatalogLoad): LabCatalog => {
  const groups = new Map<string, Array<LabEntry>>()
  for (const { file, showcase } of load.loaded) {
    const entry = entryOf(showcase, file)
    const group = groups.get(entry.component)
    if (group === undefined) {
      groups.set(entry.component, [entry])
    } else {
      group.push(entry)
    }
  }
  const components = [...groups.entries()].map(
    ([component, entries]) => new LabComponent({ component, entries: Arr.sort(entries, byId) }),
  )
  return new LabCatalog({
    components: Arr.sort(components, byComponent),
    failures: load.failures,
    total: load.loaded.length,
  })
}
