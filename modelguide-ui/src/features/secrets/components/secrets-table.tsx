import { Key, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { formatDate } from '~/lib/utils'
import type { Secret } from '~/schemas/secrets'

interface SecretsTableProps {
  secrets: Secret[]
  isLoading: boolean
  isAdmin: boolean
  onEdit: (secret: Secret) => void
  onDelete: (secret: Secret) => void
}

const secretTypeLabels: Record<string, string> = {
  api_key: 'API Key',
  oauth_token: 'OAuth Token',
  credentials: 'Credentials',
}

export function SecretsTable({ secrets, isLoading, isAdmin, onEdit, onDelete }: SecretsTableProps) {
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
              Type
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
              onEdit={() => onEdit(secret)}
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
  onEdit: () => void
  onDelete: () => void
  style?: React.CSSProperties
}

function SecretRow({ secret, isAdmin, onEdit, onDelete, style }: SecretRowProps) {
  const [showMenu, setShowMenu] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })

  useEffect(() => {
    if (showMenu && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      })
    }
  }, [showMenu])

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
        <Badge variant="default">{secretTypeLabels[secret.secretType] ?? secret.secretType}</Badge>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-fg-secondary">{formatDate(secret.createdAt)}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-fg-secondary">{formatDate(secret.updatedAt)}</span>
      </td>
      {isAdmin ? (
        <td className="px-4 py-3 text-right">
          <Button
            ref={buttonRef}
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
          {showMenu
            ? createPortal(
                <>
                  <div
                    className="fixed inset-0"
                    style={{ zIndex: 9998 }}
                    onClick={() => setShowMenu(false)}
                    onKeyDown={(e) => e.key === 'Escape' && setShowMenu(false)}
                    role="button"
                    tabIndex={0}
                    aria-label="Close menu"
                  />
                  <div
                    className="fixed w-32 rounded-lg border border-fg-subtle/20 bg-bg-elevated py-1 shadow-lg"
                    style={{ zIndex: 9999, top: menuPos.top, right: menuPos.right }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false)
                        onEdit()
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-secondary hover:bg-bg-subtle"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
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
                </>,
                document.body,
              )
            : null}
        </td>
      ) : null}
    </tr>
  )
}
