// The machine-readable documents `--json` prints, and the Schemas they are
// built from.
//
// `foldcase test --json` and `foldcase docs --json` are sold as contracts: one
// JSON document on stdout, diagnostics on stderr. A contract a consumer cannot
// decode with the Schema that produced it is a shape they have to re-declare by
// hand — the "second definition" ADR-0001 exists to prevent, one surface out.
// So the documents live here, on a published entry point, and the CLI imports
// them rather than declaring its own.
//
// Nothing is re-declared: every part is the Schema its own module already
// exports, gathered so a reader of the document has one import to make.

import * as Schema from "effect/Schema"

import { ShowcaseModuleError } from "./cli.js"
import { CoverageReport } from "./coverage/report.js"
import { StaleDoc, WrittenDoc } from "./docs/generate.js"
import { SuiteReport } from "./runner.js"

/**
 * What `foldcase test --json` prints: the suite report, and the coverage report
 * beside it when `--coverage` collected one. One document, so a reader parses
 * stdout once instead of splitting a summary from a report printed after it.
 */
export class TestDocument extends Schema.Class<TestDocument>("foldcase/TestDocument")({
  suite: SuiteReport,
  coverage: Schema.optional(CoverageReport),
}) {}

/**
 * What `foldcase docs --json` prints: the documents written, by component and
 * path, and the files that would not load, with the reason each was skipped.
 * The same two facts the human output says, in the order a reader needs them.
 *
 * `stale` is the third, and it is optional so a reader of an older document
 * stays right: it is present only under `--check`, which writes nothing — so
 * `docs` is empty there, because nothing was written, and `stale` names every
 * document the out-dir does not already hold. An empty `stale` therefore says
 * "checked, and current", which no absent field could.
 */
export class DocsDocument extends Schema.Class<DocsDocument>("foldcase/DocsDocument")({
  docs: Schema.Array(WrittenDoc),
  failures: Schema.Array(ShowcaseModuleError),
  stale: Schema.optional(Schema.Array(StaleDoc)),
}) {}

// The parts, re-exported from where they are declared. A consumer decoding half
// a document — the coverage, one written page — names the same Schema the tool
// encoded it with.
export { ShowcaseModuleError } from "./cli.js"
export { SkippedFile } from "./coverage/coverage.js"
export { CoverageReport, FileCoverage, ShowcaseCoverage } from "./coverage/report.js"
export { StaleDoc, WrittenDoc } from "./docs/generate.js"
export { SerializedError, ShowcaseReport, SuiteReport } from "./runner.js"
