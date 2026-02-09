import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

interface ChannelBreakdownProps {
  data: Record<string, number>
}

const CHANNEL_LABELS: Record<string, string> = {
  voice: 'Voice',
  web: 'Web',
  widget: 'Widget',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  api: 'API',
  slack: 'Slack',
  email: 'Email',
}

export function ChannelBreakdown({ data }: ChannelBreakdownProps) {
  const chartData = Object.entries(data)
    .filter(([, count]) => count > 0)
    .map(([channel, count]) => ({
      channel: CHANNEL_LABELS[channel] ?? channel,
      count,
    }))
    .sort((a, b) => b.count - a.count)

  return (
    <Card className="animate-fade-up" style={{ animationDelay: '200ms' }}>
      <CardHeader>
        <CardTitle>Sessions by Channel</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 60, bottom: 5 }}
            >
              <XAxis
                type="number"
                tick={{
                  fill: 'var(--color-fg-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                axisLine={{ stroke: 'var(--color-fg-subtle)', opacity: 0.3 }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="channel"
                tick={{
                  fill: 'var(--color-fg-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                axisLine={false}
                tickLine={false}
                width={60}
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
                itemStyle={{ color: '#fafafa' }}
                labelStyle={{ color: '#a8a8b3' }}
                cursor={{ fill: '#f97316', opacity: 0.1 }}
              />
              <Bar
                dataKey="count"
                name="Sessions"
                fill="var(--color-brand-500)"
                radius={[0, 4, 4, 0]}
                barSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
