import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { formatDuration, formatPercent } from '~/lib/utils'
import type { AgentPerformanceItem } from '~/schemas/analytics'

interface AgentPerformanceProps {
  agents: AgentPerformanceItem[]
  isLoading: boolean
}

function rateColor(
  value: number,
  { green, red }: { green: (v: number) => boolean; red: (v: number) => boolean },
) {
  if (green(value)) return 'text-success'
  if (red(value)) return 'text-error'
  return 'text-fg-primary'
}

export function AgentPerformance({ agents, isLoading }: AgentPerformanceProps) {
  if (isLoading) {
    return (
      <Card className="animate-fade-up" style={{ animationDelay: '300ms' }}>
        <CardHeader>
          <CardTitle>Agent Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (agents.length === 0) {
    return (
      <Card className="animate-fade-up" style={{ animationDelay: '300ms' }}>
        <CardHeader>
          <CardTitle>Agent Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-fg-muted">No agent data available</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="animate-fade-up" style={{ animationDelay: '300ms' }}>
      <CardHeader>
        <CardTitle>Agent Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-fg-subtle/20">
                <th className="pb-3 pr-4 text-left font-medium text-fg-muted">#</th>
                <th className="pb-3 pr-4 text-left font-medium text-fg-muted">Agent</th>
                <th className="pb-3 pr-4 text-right font-medium text-fg-muted">Sessions</th>
                <th className="pb-3 pr-4 text-right font-medium text-fg-muted">Resolution</th>
                <th className="pb-3 pr-4 text-right font-medium text-fg-muted">Avg Duration</th>
                <th className="pb-3 text-right font-medium text-fg-muted">CSAT</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => (
                <tr key={agent.agent_id} className="border-b border-fg-subtle/10 last:border-0">
                  <td className="py-3 pr-4 font-mono text-fg-muted">{index + 1}</td>
                  <td className="py-3 pr-4 font-medium text-fg-primary">{agent.agent_name}</td>
                  <td className="py-3 pr-4 text-right font-mono text-fg-primary">
                    {agent.total_sessions}
                  </td>
                  <td
                    className={`py-3 pr-4 text-right font-mono ${rateColor(agent.resolution_rate, {
                      green: (v) => v >= 0.8,
                      red: (v) => v < 0.5,
                    })}`}
                  >
                    {formatPercent(agent.resolution_rate)}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-fg-primary">
                    {agent.avg_duration_seconds != null
                      ? formatDuration(agent.avg_duration_seconds)
                      : '\u2014'}
                  </td>
                  <td className="py-3 text-right font-mono text-fg-primary">
                    {agent.csat_score != null
                      ? `${(agent.csat_score * 100).toFixed(1)}%`
                      : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
