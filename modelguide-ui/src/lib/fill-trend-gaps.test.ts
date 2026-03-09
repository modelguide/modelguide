import { describe, expect, it } from 'vitest'
import { fillTrendGaps } from './fill-trend-gaps'

describe('fillTrendGaps', () => {
  describe('day granularity', () => {
    it('fills gaps with zero values for missing days', () => {
      const data = [{ date: '2025-06-01T00:00:00.000Z', value: 5 }]
      const result = fillTrendGaps(data, '2025-06-01', '2025-06-03', 'day')

      expect(result).toHaveLength(3)
      expect(result[0].value).toBe(5)
      expect(result[1].value).toBe(0)
      expect(result[2].value).toBe(0)
    })

    it('returns empty when range is empty', () => {
      const result = fillTrendGaps([], '2025-06-03', '2025-06-01', 'day')
      expect(result).toHaveLength(0)
    })
  })

  describe('hour granularity', () => {
    it('fills gaps with zero values using 1-hour increments', () => {
      const data = [
        { date: '2025-06-01T02:00:00.000Z', value: 10 },
        { date: '2025-06-01T05:00:00.000Z', value: 3 },
      ]
      const result = fillTrendGaps(data, '2025-06-01', '2025-06-01', 'hour')

      // 24 hours in a day (00:00 through 23:00)
      expect(result).toHaveLength(24)
      expect(result[0].value).toBe(0) // 00:00
      expect(result[1].value).toBe(0) // 01:00
      expect(result[2].value).toBe(10) // 02:00
      expect(result[3].value).toBe(0) // 03:00
      expect(result[5].value).toBe(3) // 05:00
    })

    it('uses hour-level precision for map keys', () => {
      // Two data points in same day but different hours should not collide
      const data = [
        { date: '2025-06-01T10:00:00.000Z', value: 7 },
        { date: '2025-06-01T14:00:00.000Z', value: 12 },
      ]
      const result = fillTrendGaps(data, '2025-06-01', '2025-06-01', 'hour')

      expect(result[10].value).toBe(7)
      expect(result[14].value).toBe(12)
      // Other hours should be 0
      expect(result[0].value).toBe(0)
      expect(result[23].value).toBe(0)
    })

    it('works across multiple days', () => {
      const data = [{ date: '2025-06-01T12:00:00.000Z', value: 5 }]
      const result = fillTrendGaps(data, '2025-06-01', '2025-06-02', 'hour')

      // 2 days * 24 hours = 48 hours
      expect(result).toHaveLength(48)
      expect(result[12].value).toBe(5) // day 1, 12:00
      expect(result[36].value).toBe(0) // day 2, 12:00
    })

    it('respects the 400-iteration safety cap', () => {
      // 17 days * 24 = 408 hours, should be capped at 400
      const result = fillTrendGaps([], '2025-06-01', '2025-06-17', 'hour')
      expect(result).toHaveLength(400)
    })
  })

  describe('week granularity', () => {
    it('aligns to Monday and fills weekly gaps', () => {
      const result = fillTrendGaps([], '2025-06-01', '2025-06-21', 'week')

      // All generated dates should be Mondays
      for (const point of result) {
        const day = new Date(point.date).getUTCDay()
        expect(day).toBe(1) // Monday
      }
    })
  })

  describe('month granularity', () => {
    it('fills monthly gaps with zero values', () => {
      const data = [{ date: '2025-01-01T00:00:00.000Z', value: 100 }]
      const result = fillTrendGaps(data, '2025-01', '2025-03', 'month')

      expect(result.length).toBeGreaterThanOrEqual(3)
      expect(result[0].value).toBe(100)
      expect(result[1].value).toBe(0)
      expect(result[2].value).toBe(0)
    })
  })
})
