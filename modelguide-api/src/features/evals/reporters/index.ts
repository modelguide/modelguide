/**
 * Reporter registry — maps reporter name to implementation.
 */

import { consoleReporter } from "./console";
import type { EvalReporter } from "./reporter.types";

const reporters: ReadonlyMap<string, EvalReporter> = new Map([
  ["console", consoleReporter],
]);

export function getReporter(name?: string): EvalReporter {
  if (!name) return consoleReporter;

  const reporter = reporters.get(name);
  if (!reporter) {
    throw new Error(`Unknown reporter: "${name}"`);
  }
  return reporter;
}
