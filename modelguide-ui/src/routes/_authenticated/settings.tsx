import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { PageHeader } from '~/components/ui/page-header'
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
      <PageHeader
        icon={Settings}
        iconBg="bg-fg-subtle/15"
        iconColor="text-fg-secondary"
        title="Settings"
        description="Manage your account and preferences"
      />

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
