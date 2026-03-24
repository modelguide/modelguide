/**
 * CLI output helpers — colored console output with simple formatting.
 */

import * as p from "@clack/prompts";

export const log = {
  success(message: string): void {
    p.log.success(message);
  },

  info(message: string): void {
    p.log.info(message);
  },

  warn(message: string): void {
    p.log.warn(message);
  },

  error(message: string): void {
    p.log.error(message);
  },

  step(message: string): void {
    p.log.step(message);
  },
};

export function intro(title: string): void {
  p.intro(title);
}

export function outro(message: string): void {
  p.outro(message);
}

export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = `+-${widths.map((w) => "-".repeat(w)).join("-+-")}-+`;
  const headerRow = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(" | ")} |`;
  const dataRows = rows.map(
    (row) =>
      `| ${row.map((cell, i) => (cell ?? "").padEnd(widths[i])).join(" | ")} |`,
  );

  return [sep, headerRow, sep, ...dataRows, sep].join("\n");
}
