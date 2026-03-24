/**
 * Shared error utilities for CLI commands.
 */

/**
 * Check if an error indicates a duplicate/already-exists condition.
 * Centralizes the string matching so all commands behave consistently.
 */
export function isDuplicateError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("duplicate") ||
    msg.includes("already exists") ||
    msg.includes("unique")
  );
}

/**
 * Extract a human-readable message from an unknown error.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
