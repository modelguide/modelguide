import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FlaskConical, Plus } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { PageHeader } from '~/components/ui/page-header'
import { Pagination } from '~/components/ui/pagination'
import { InitSuiteDialog } from '~/features/evals/components/init-suite-dialog'
import { SuitesTable } from '~/features/evals/components/suites-table'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import { useIsAdmin } from '~/lib/permissions'
import type { EvalSuiteSummary } from '~/schemas/eval-suites'

const evalsSearchSchema = z.object({
  agentId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/evals/')({
  component: EvalsPage,
  validateSearch: evalsSearchSchema,
})

function EvalsPage() {
  const isAdmin = useIsAdmin()
  const { agentId } = Route.useSearch()
  const [showInitDialog, setShowInitDialog] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 20

  const searchParams: Record<string, string | number> = { page, pageSize }
  if (agentId) searchParams.agentId = agentId

  const { data, isLoading } = useQuery({
    queryKey: ['eval-suites', page, agentId],
    queryFn: () =>
      api.get('eval-suites', { searchParams }).json<PaginatedResponse<EvalSuiteSummary>>(),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FlaskConical}
        iconBg="bg-cyan-500/15"
        iconColor="text-cyan-400"
        title="Eval Suites"
        description="Evaluate agent performance against SOPs"
        actions={
          isAdmin ? (
            <Button onClick={() => setShowInitDialog(true)}>
              <Plus className="h-4 w-4" />
              Create Eval Suite
            </Button>
          ) : null
        }
      />

      <SuitesTable suites={data?.data ?? []} isLoading={isLoading} />

      {data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.pagination.totalItems}
          onPageChange={setPage}
        />
      )}

      {isAdmin ? (
        <InitSuiteDialog open={showInitDialog} onClose={() => setShowInitDialog(false)} />
      ) : null}
    </div>
  )
}
