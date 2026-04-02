/** Pass-rate thresholds for eval suite run status coloring. */
export const PASS_RATE_THRESHOLDS = { success: 80, warning: 60 } as const

export function passRateVariant(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= PASS_RATE_THRESHOLDS.success) return 'success'
  if (pct >= PASS_RATE_THRESHOLDS.warning) return 'warning'
  return 'error'
}
