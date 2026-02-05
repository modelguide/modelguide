import { Key, MoreVertical, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { formatDate } from '~/lib/utils'
import type { Secret } from '~/schemas/secrets'

interface SecretsTableProps {
  secrets: Secret[]
  isLoading: boolean
  isAdmin: boolean
  onDelete: (secret: Secret) => void
}

export function SecretsTable({ secrets, isLoading, isAdmin, onDelete }: SecretsTableProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (secrets.length === 0) {
    return (
      <div className="rounded-lg border border-fg-subtle/20 bg-bg-elevated p-12 text-center">
        <Key className="mx-auto h-8 w-8 text-fg-muted" />
        <p className="mt-4 text-sm text-fg-secondary">No secrets found</p>
        <p className="mt-1 font-sans text-xs text-fg-muted">
          Create a secret to store API keys and tokens securely
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-fg-subtle/20 bg-bg-elevated">
      <table className="w-full">
        <thead>
          <tr className="border-b border-fg-subtle/20 bg-bg-subtle/50">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Name
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Created
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Updated
            </th>
            {isAdmin ? (
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {secrets.map((secret, index) => (
            <SecretRow
              key={secret.id}
              secret={secret}
              isAdmin={isAdmin}
              onDelete={() => onDelete(secret)}
              style={{ animationDelay: `${index * 30}ms` }}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface SecretRowProps {
  secret: Secret
  isAdmin: boolean
  onDelete: () => void
  style?: React.CSSProperties
}

function SecretRow({ secret, isAdmin, onDelete, style }: SecretRowProps) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <tr
      className="animate-fade-up border-b border-fg-subtle/10 last:border-0 hover:bg-bg-subtle/30"
      style={style}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-brand/10">
            <Key className="h-4 w-4 text-brand" />
          </div>
          <span className="text-sm font-medium text-fg-primary">{secret.name}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-fg-secondary">{formatDate(secret.created_at)}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-fg-secondary">{formatDate(secret.updated_at)}</span>
      </td>
      {isAdmin ? (
        <td className="px-4 py-3 text-right">
          <div className="relative inline-block">
            <Button variant="ghost" size="icon-sm" onClick={() => setShowMenu(!showMenu)}>
              <MoreVertical className="h-4 w-4" />
            </Button>
            {showMenu ? (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                  onKeyDown={(e) => e.key === 'Escape' && setShowMenu(false)}
                  role="button"
                  tabIndex={0}
                  aria-label="Close menu"
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-fg-subtle/20 bg-bg-elevated py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      onDelete()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </td>
      ) : null}
    </tr>
  )
}
