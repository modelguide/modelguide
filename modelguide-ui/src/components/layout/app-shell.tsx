import { Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { cn } from '~/lib/cn'
import { DemoBanner } from './demo-banner'
import { Header } from './header'
import { Sidebar } from './sidebar'

export interface AppShellProps {
  user: {
    name: string
    email: string
    role: 'admin' | 'support' | 'viewer'
    avatarUrl?: string
  }
  pageTitle?: string
  onLogout: () => void
}

export function AppShell({ user, pageTitle, onLogout }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      {/* Mobile sidebar overlay */}
      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      ) : null}

      {/* Sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-60 transform transition-transform duration-200 ease-out lg:static lg:transform-none',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <Sidebar user={user} />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {user.role === 'viewer' && <DemoBanner />}
        <Header
          title={pageTitle}
          showMenuButton
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          onLogout={onLogout}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
