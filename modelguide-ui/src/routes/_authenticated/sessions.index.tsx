import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '~/components/ui/page-header'
import { Pagination } from '~/components/ui/pagination'
import {
  type SessionFilters,
  SessionsFilters,
} from '~/features/sessions/components/sessions-filters'
import { SessionsTable } from '~/features/sessions/components/sessions-table'
import { api } from '~/lib/api'
import type { SessionListResponse } from '~/schemas/sessions'

export const Route = createFileRoute('/_authenticated/sessions/')({
  component: SessionsPage,
})

function SessionsPage() {
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<SessionFilters>({})
  const pageSize = 20

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', page, filters],
    queryFn: () => {
      const params: Record<string, string | number> = {
        page,
        page_size: pageSize,
      }
      if (filters.status) params.status = filters.status
      if (filters.channel_type) params.channel_type = filters.channel_type
      if (filters.agent_id) params.agent_id = filters.agent_id

      return api.get('sessions', { searchParams: params }).json<SessionListResponse>()
    },
  })

  const handleFiltersChange = (newFilters: SessionFilters) => {
    setFilters(newFilters)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageSquare}
        iconBg="bg-info/15"
        iconColor="text-info"
        title="Sessions"
        description="Browse and analyze conversation sessions"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SessionsFilters filters={filters} onFiltersChange={handleFiltersChange} />
      </div>

      <SessionsTable sessions={data?.items ?? []} isLoading={isLoading} total={data?.total} />

      {data && (
        <Pagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} />
      )}
    </div>
  )
}
