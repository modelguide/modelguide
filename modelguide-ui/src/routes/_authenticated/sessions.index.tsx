import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
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
      <div className="animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-info/15">
            <MessageSquare className="h-5 w-5 text-info" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
              Sessions
            </h1>
            <p className="text-sm text-fg-muted">Browse and analyze conversation sessions</p>
          </div>
        </div>
      </div>

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
