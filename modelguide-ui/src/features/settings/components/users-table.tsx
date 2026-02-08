import { useQuery } from '@tanstack/react-query'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import { formatDate } from '~/lib/utils'
import type { UserListItem } from '~/schemas/auth'

export function UsersTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('users').json<PaginatedResponse<UserListItem>>(),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : data?.data?.length ? (
          <div className="overflow-hidden rounded-lg border border-fg-subtle/20">
            <table className="w-full">
              <thead>
                <tr className="border-b border-fg-subtle/20 bg-bg-subtle/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Last Login
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-fg-subtle/10 last:border-0 hover:bg-bg-subtle/30"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-fg-primary">{user.name}</td>
                    <td className="px-4 py-3 text-sm text-fg-secondary">{user.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={user.role === 'admin' ? 'brand' : 'default'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={user.isActive ? 'success' : 'default'}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">
                      {user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">
                      {formatDate(user.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-8 text-center font-sans text-sm text-fg-muted">No users found</p>
        )}
      </CardContent>
    </Card>
  )
}
