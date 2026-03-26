/**
 * Interactive prompt wrappers for CLI secret input.
 */

import * as p from "@clack/prompts";

/**
 * Prompt for a secret value (masked input).
 */
export async function promptSecret(name: string): Promise<string> {
  const value = await p.password({
    message: `Enter value for "${name}":`,
  });
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(1);
  }
  return value;
}

/**
 * Generate a placeholder value for a secret when --skip-secrets is used.
 */
export function generatePlaceholder(name: string): string {
  return `placeholder_${name.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Confirm an action.
 */
export async function confirm(message: string): Promise<boolean> {
  const result = await p.confirm({ message });
  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(1);
  }
  return result;
}
