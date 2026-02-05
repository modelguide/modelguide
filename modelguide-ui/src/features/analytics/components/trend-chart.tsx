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
import type { AnalyticsTrendPoint } from '~/schemas/analytics'

interface TrendChartProps {
  data: AnalyticsTrendPoint[]
}

export function TrendChart({ data }: TrendChartProps) {
  const formattedData = data.map((point) => ({
    ...point,
    displayDate: new Date(point.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }))

  return (
    <Card className="animate-fade-up" style={{ animationDelay: '100ms' }}>
      <CardHeader>
        <CardTitle>Sessions Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formattedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
                tick={{
                  fill: 'var(--color-fg-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                axisLine={{ stroke: 'var(--color-fg-subtle)', opacity: 0.3 }}
                tickLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-fg-subtle)',
                  borderRadius: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                }}
                labelStyle={{ color: 'var(--color-fg-primary)' }}
              />
              <Line
                type="monotone"
                dataKey="sessions"
                name="Sessions"
                stroke="var(--color-brand)"
                strokeWidth={2}
                dot={{ fill: 'var(--color-brand)', strokeWidth: 0, r: 3 }}
                activeDot={{ fill: 'var(--color-brand)', strokeWidth: 0, r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="resolutions"
                name="Resolutions"
                stroke="var(--color-success)"
                strokeWidth={2}
                dot={{ fill: 'var(--color-success)', strokeWidth: 0, r: 3 }}
                activeDot={{ fill: 'var(--color-success)', strokeWidth: 0, r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="escalations"
                name="Escalations"
                stroke="var(--color-warning)"
                strokeWidth={2}
                dot={{ fill: 'var(--color-warning)', strokeWidth: 0, r: 3 }}
                activeDot={{ fill: 'var(--color-warning)', strokeWidth: 0, r: 5 }}
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
            <span className="font-mono text-xs text-fg-muted">Resolutions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-warning" />
            <span className="font-mono text-xs text-fg-muted">Escalations</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
