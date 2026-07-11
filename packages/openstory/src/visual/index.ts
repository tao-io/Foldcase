export * from "./types.js";
export * from "./constants.js";
export { classifyVisualDiff } from "./classify.js";
export { comparePng, type PngComparison } from "./compare.js";
export {
  baselinePathFor,
  diffPathFor,
  evaluateShowcase,
  type EvaluateShowcaseOptions,
  type VisualGateMode,
} from "./baseline.js";
export { applyJudge } from "./judge.js";
export { buildReport, exitCodeForReport, formatReport } from "./report.js";
export { runVisualGate, type VisualGateOptions } from "./gate.js";
export { captureShowcase, type CaptureShowcaseOptions } from "./capture.js";
