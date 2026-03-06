/** Shared timing helper for eval execution paths. */
export function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}
