import { Link, useLocation } from '@tanstack/react-router'
import {
  Activity,
  Bot,
  ClipboardList,
  Key,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Avatar } from '~/components/ui/avatar'
import { cn } from '~/lib/cn'
import { Logo } from './logo'

type Role = 'admin' | 'support' | 'viewer'

interface NavItem {
  label: string
  href: string
  icon: ReactNode
  /** When set, only these roles see the item. Omit to show to all roles in the section. */
  roles?: Role[]
}

const mainNav: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: 'Sessions', href: '/sessions', icon: <MessageSquare className="h-4 w-4" /> },
  { label: 'Analytics', href: '/analytics', icon: <Activity className="h-4 w-4" /> },
]

const adminNav: NavItem[] = [
  { label: 'Agents', href: '/agents', icon: <Bot className="h-4 w-4" /> },
  { label: 'Connectors', href: '/connectors', icon: <Plug className="h-4 w-4" /> },
  { label: 'SOPs', href: '/sops', icon: <ClipboardList className="h-4 w-4" /> },
  { label: 'Secrets', href: '/secrets', icon: <Key className="h-4 w-4" />, roles: ['admin'] },
]

interface SidebarProps {
  user: {
    name: string
    email: string
    role: Role
    avatarUrl?: string
  }
}

function visibleItems(items: NavItem[], role: Role): NavItem[] {
  return items.filter((item) => !item.roles || item.roles.includes(role))
}

export function Sidebar({ user }: SidebarProps) {
  const location = useLocation()
  const canBrowseAdmin = user.role === 'admin' || user.role === 'viewer'

  return (
    <aside className="relative flex h-screen w-[260px] flex-col border-r border-fg-subtle/10 bg-bg-elevated">
      {/* Ambient glow at top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-brand-500/5 to-transparent" />

      {/* Logo */}
      <div className="relative flex h-16 items-center px-5">
        <Logo size="lg" />
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 overflow-y-auto px-3 py-6">
        {/* Main Section */}
        <div className="mb-8">
          <h3 className="mb-3 px-3 font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">
            Main
          </h3>
          <ul className="space-y-1">
            {visibleItems(mainNav, user.role).map((item) => (
              <NavLink
                key={item.href}
                item={item}
                isActive={
                  item.href === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.href)
                }
              />
            ))}
          </ul>
        </div>

        {/* Admin Section */}
        {canBrowseAdmin && (
          <div>
            <h3 className="mb-3 px-3 font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-subtle">
              Admin
            </h3>
            <ul className="space-y-1">
              {visibleItems(adminNav, user.role).map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={location.pathname.startsWith(item.href)}
                />
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* User section */}
      <div className="relative border-t border-fg-subtle/10 p-4">
        <Link
          to="/settings"
          className={cn(
            'group flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-200',
            'hover:bg-bg-subtle',
            location.pathname === '/settings' && 'bg-bg-subtle',
          )}
        >
          <div className="relative">
            <Avatar name={user.name} src={user.avatarUrl} size="md" />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-elevated bg-success" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg-primary">{user.name}</p>
            <p className="truncate text-xs text-fg-muted">{user.role}</p>
          </div>
          <Settings className="h-4 w-4 text-fg-subtle transition-colors group-hover:text-fg-secondary" />
        </Link>
      </div>
    </aside>
  )
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <li>
      <Link
        to={item.href}
        data-active={isActive}
        className={cn(
          'nav-item flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
          isActive
            ? 'text-brand-400'
            : 'text-fg-secondary hover:bg-bg-subtle/50 hover:text-fg-primary',
        )}
      >
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
            isActive
              ? 'bg-brand-500/15 text-brand-400'
              : 'bg-bg-subtle text-fg-muted group-hover:text-fg-secondary',
          )}
        >
          {item.icon}
        </span>
        {item.label}
      </Link>
    </li>
  )
}
