import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

interface StatusBreakdownProps {
  data: {
    completed: number
    escalated: number
    abandoned: number
    active: number
  }
}

const COLORS = {
  completed: 'var(--color-success)',
  escalated: 'var(--color-warning)',
  abandoned: 'var(--color-error)',
  active: 'var(--color-brand)',
}

export function StatusBreakdown({ data }: StatusBreakdownProps) {
  const chartData = [
    { name: 'Completed', value: data.completed, color: COLORS.completed },
    { name: 'Escalated', value: data.escalated, color: COLORS.escalated },
    { name: 'Abandoned', value: data.abandoned, color: COLORS.abandoned },
    { name: 'Active', value: data.active, color: COLORS.active },
  ]

  const total = Object.values(data).reduce((sum, val) => sum + val, 0)

  return (
    <Card className="animate-fade-up" style={{ animationDelay: '150ms' }}>
      <CardHeader>
        <CardTitle>Session Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry) => (
                  <Cell key={`cell-${entry.name}`} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-fg-subtle)',
                  borderRadius: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                }}
                formatter={(value) => {
                  const numValue = Number(value) || 0
                  return [`${numValue} (${((numValue / total) * 100).toFixed(1)}%)`, '']
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {chartData.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-lg bg-bg-subtle/50 p-2"
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="font-mono text-xs text-fg-muted">{item.name}</span>
              </div>
              <span className="font-mono text-xs font-medium text-fg-primary">{item.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
