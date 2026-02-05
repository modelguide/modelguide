import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { AppearanceSettings } from '~/features/settings/components/appearance-settings'
import { ProfileForm } from '~/features/settings/components/profile-form'
import { UsersTable } from '~/features/settings/components/users-table'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fg-subtle/15">
            <Settings className="h-5 w-5 text-fg-secondary" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
              Settings
            </h1>
            <p className="text-sm text-fg-muted">Manage your account and preferences</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <ProfileForm />
        </div>
        <div className="space-y-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <AppearanceSettings />
        </div>
      </div>

      {isAdmin ? (
        <div className="animate-fade-up" style={{ animationDelay: '150ms' }}>
          <UsersTable />
        </div>
      ) : null}
    </div>
  )
}
