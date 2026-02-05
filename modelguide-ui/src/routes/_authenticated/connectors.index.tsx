import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plug } from 'lucide-react'
import { ConnectorsGrid } from '~/features/connectors/components/connectors-grid'
import { api } from '~/lib/api'
import type { ConnectorListResponse } from '~/schemas/connectors'

export const Route = createFileRoute('/_authenticated/connectors/')({
  component: ConnectorsPage,
})

function ConnectorsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('connectors').json<ConnectorListResponse>(),
  })

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo/15">
            <Plug className="h-5 w-5 text-indigo" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
              Connectors
            </h1>
            <p className="text-sm text-fg-muted">Configure integrations with external services</p>
          </div>
        </div>
      </div>

      <ConnectorsGrid connectors={data?.items ?? []} isLoading={isLoading} />
    </div>
  )
}
