import type { TrendPoint } from '~/schemas/analytics'

/** Build a map key from an ISO date string at the appropriate granularity. */
function toMapKey(isoDate: string, granularity: 'day' | 'week' | 'month' | 'hour'): string {
  if (granularity === 'hour') {
    // "2024-06-15T14:00:00.000Z" → "2024-06-15T14"
    return isoDate.slice(0, 13)
  }
  return isoDate.split('T')[0]
}

export function fillTrendGaps(
  data: TrendPoint[],
  from: string,
  to: string,
  granularity: 'day' | 'week' | 'month' | 'hour',
): TrendPoint[] {
  const dataMap = new Map<string, number>()
  for (const point of data) {
    const key = toMapKey(point.date, granularity)
    dataMap.set(key, point.value)
  }

  const result: TrendPoint[] = []
  const current = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T23:59:59Z`)
  const maxIterations = 400

  // Align to Monday for week granularity to match PostgreSQL date_trunc('week', ...)
  if (granularity === 'week') {
    const day = current.getUTCDay()
    // getUTCDay(): 0=Sun, 1=Mon. Shift back to previous Monday.
    const diff = day === 0 ? 6 : day - 1
    current.setUTCDate(current.getUTCDate() - diff)
  }

  while (current <= end && result.length < maxIterations) {
    const key = toMapKey(current.toISOString(), granularity)
    result.push({
      date: current.toISOString(),
      value: dataMap.get(key) ?? 0,
    })

    if (granularity === 'hour') {
      current.setUTCHours(current.getUTCHours() + 1)
    } else if (granularity === 'day') {
      current.setUTCDate(current.getUTCDate() + 1)
    } else if (granularity === 'week') {
      current.setUTCDate(current.getUTCDate() + 7)
    } else {
      current.setUTCMonth(current.getUTCMonth() + 1)
    }
  }

  return result
}
