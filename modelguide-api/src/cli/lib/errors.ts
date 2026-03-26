/**
 * Shared error utilities for CLI commands.
 */

/**
 * Check if an error indicates a duplicate/already-exists condition.
 * Checks PostgreSQL error code 23505 (unique_violation) first,
 * falls back to string matching for service-layer errors that wrap the original.
 */
export function isDuplicateError(err: unknown): boolean {
  if (
    err instanceof Error &&
    (err as Error & { code?: string }).code === "23505"
  ) {
    return true;
  }
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes("duplicate") ||
    msg.includes("already exists") ||
    msg.includes("unique constraint")
  );
}

/**
 * Extract a human-readable message from an unknown error.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
