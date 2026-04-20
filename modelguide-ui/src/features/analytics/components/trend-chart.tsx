import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import type { TrendPoint } from '~/schemas/analytics'

interface TrendChartProps {
  sessions: TrendPoint[]
  resolutions: TrendPoint[]
  isLoading: boolean
}

interface MergedPoint {
  displayDate: string
  sessions: number
  resolutions: number
}

function getOrCreate(map: Map<string, MergedPoint>, key: string, display: string): MergedPoint {
  let entry = map.get(key)
  if (!entry) {
    entry = { displayDate: display, sessions: 0, resolutions: 0 }
    map.set(key, entry)
  }
  return entry
}

function formatDisplay(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function mergeTrendData(sessions: TrendPoint[], resolutions: TrendPoint[]): MergedPoint[] {
  const map = new Map<string, MergedPoint>()

  for (const p of sessions) {
    const key = p.date.split('T')[0]
    getOrCreate(map, key, formatDisplay(p.date)).sessions = p.value
  }

  for (const p of resolutions) {
    const key = p.date.split('T')[0]
    // Convert rate (0-1) to percentage for display
    getOrCreate(map, key, formatDisplay(p.date)).resolutions = Math.round(p.value * 100)
  }

  return Array.from(map.values())
}

export function TrendChart({ sessions, resolutions, isLoading }: TrendChartProps) {
  if (isLoading) {
    return (
      <Card className="animate-fade-up" style={{ animationDelay: '100ms' }}>
        <CardHeader>
          <CardTitle>Sessions Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-72 items-center justify-center">
            <Spinner size="lg" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const data = mergeTrendData(sessions, resolutions)

  if (data.length === 0) {
    return (
      <Card className="animate-fade-up" style={{ animationDelay: '100ms' }}>
        <CardHeader>
          <CardTitle>Sessions Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-72 items-center justify-center">
            <p className="text-sm text-fg-muted">No trend data available</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="animate-fade-up" style={{ animationDelay: '100ms' }}>
      <CardHeader>
        <CardTitle>Sessions Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-fg-subtle)" opacity={0.2} />
              <XAxis
                dataKey="displayDate"
                tick={{
                  fill: 'var(--color-fg-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                axisLine={{ stroke: 'var(--color-fg-subtle)', opacity: 0.3 }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{
                  fill: 'var(--color-fg-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                axisLine={{ stroke: 'var(--color-fg-subtle)', opacity: 0.3 }}
                tickLine={false}
                width={40}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{
                  fill: 'var(--color-fg-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                axisLine={{ stroke: 'var(--color-fg-subtle)', opacity: 0.3 }}
                tickLine={false}
                width={40}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#141416',
                  border: '1px solid #45454d',
                  borderRadius: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: '#fafafa',
                }}
                labelStyle={{ color: '#a8a8b3' }}
                formatter={(value, name) => {
                  // recharts' Formatter now types value as ValueType (number | string)
                  // and name similarly. Coerce defensively — our payloads always
                  // feed numbers, but the type is broader. Guard against NaN so
                  // tooltips never render "NaN%" on a bad/missing datapoint.
                  const raw = typeof value === 'number' ? value : Number(value ?? 0)
                  const numeric = Number.isFinite(raw) ? raw : 0
                  const label = typeof name === 'string' ? name : String(name ?? '')
                  return label === 'Sessions' ? [numeric, label] : [`${numeric}%`, label]
                }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="sessions"
                name="Sessions"
                stroke="var(--color-brand-500)"
                strokeWidth={2}
                dot={{ fill: 'var(--color-brand-500)', strokeWidth: 0, r: 3 }}
                activeDot={{ fill: 'var(--color-brand-500)', strokeWidth: 0, r: 5 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="resolutions"
                name="Resolution %"
                stroke="var(--color-success)"
                strokeWidth={2}
                dot={{ fill: 'var(--color-success)', strokeWidth: 0, r: 3 }}
                activeDot={{ fill: 'var(--color-success)', strokeWidth: 0, r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-brand" />
            <span className="font-mono text-xs text-fg-muted">Sessions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-success" />
            <span className="font-mono text-xs text-fg-muted">Resolution %</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
