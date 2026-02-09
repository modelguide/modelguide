export type RangePreset = 'last7d' | 'last30d' | 'last90d' | 'thisMonth' | 'lastMonth'

export const RANGE_LABELS: Record<RangePreset, string> = {
  last7d: 'Last 7 days',
  last30d: 'Last 30 days',
  last90d: 'Last 90 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function computeDateRange(preset: RangePreset): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'last7d': {
      const from = new Date(today)
      from.setDate(from.getDate() - 6)
      return { from: toISODate(from), to: toISODate(today) }
    }
    case 'last30d': {
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      return { from: toISODate(from), to: toISODate(today) }
    }
    case 'last90d': {
      const from = new Date(today)
      from.setDate(from.getDate() - 89)
      return { from: toISODate(from), to: toISODate(today) }
    }
    case 'thisMonth': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: toISODate(from), to: toISODate(today) }
    }
    case 'lastMonth': {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const to = new Date(today.getFullYear(), today.getMonth(), 0)
      return { from: toISODate(from), to: toISODate(to) }
    }
  }
}

export function granularityForPreset(preset: RangePreset): 'day' | 'week' {
  return preset === 'last90d' ? 'week' : 'day'
}
