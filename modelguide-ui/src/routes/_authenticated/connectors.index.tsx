import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plug } from 'lucide-react'
import { PageHeader } from '~/components/ui/page-header'
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
      <PageHeader
        icon={Plug}
        iconBg="bg-indigo/15"
        iconColor="text-indigo"
        title="Connectors"
        description="Configure integrations with external services"
      />

      <ConnectorsGrid connectors={data?.items ?? []} isLoading={isLoading} />
    </div>
  )
}
