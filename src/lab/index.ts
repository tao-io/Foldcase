/**
 * `foldcase/lab` — the browser lab shell, as an ordinary Foldkit application
 * the consumer's own dev server builds (ADR-0004).
 *
 * Two halves, and nothing else. `labCatalogOf` projects the one loader's output
 * into the document the shell renders and an agent decodes; `makeLabApplication`
 * turns that document into a running Foldkit application. Everything the lab
 * knows about a component it reads from the record, so this entry point adds no
 * description of a component and parses nothing.
 *
 * This is the only entry point that needs `foldkit`, which is why `foldkit` is
 * an optional peer: a consumer of `foldcase test` never resolves it.
 */

export {
  initialModel,
  makeLabApplication,
  Message,
  Model,
  MountedShowcase,
  SelectedShowcase,
  selectedEntry,
  update,
} from "./app.js"
export { LabCatalog, LabComponent, LabEntry, labCatalogOf } from "./catalog.js"
