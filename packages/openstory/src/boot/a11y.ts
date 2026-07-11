import type { AxeResults, NodeResult, Result } from "axe-core";
import type { A11yViolation } from "./protocol.js";

const selectorToString = (selector: string | string[]): string =>
  Array.isArray(selector) ? selector.join(" ") : selector;

const collectTargets = (nodes: ReadonlyArray<NodeResult>): string[] =>
  nodes.flatMap((node) => node.target.map(selectorToString));

export const mapAxeViolations = (results: Pick<AxeResults, "violations">): A11yViolation[] =>
  results.violations.map((violation: Result) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    helpUrl: violation.helpUrl,
    targets: collectTargets(violation.nodes),
  }));

export const runA11yAudit = async (container: HTMLElement): Promise<A11yViolation[]> => {
  const { default: axe } = await import("axe-core");
  const results = await axe.run(container);
  return mapAxeViolations(results);
};
