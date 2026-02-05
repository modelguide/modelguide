import { LogOut, Menu, Moon, Sun } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface HeaderProps {
  title?: string
  onMenuClick?: () => void
  onLogout?: () => void
  showMenuButton?: boolean
}

export function Header({ title, onMenuClick, onLogout, showMenuButton }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-fg-subtle/10 bg-bg-elevated px-4">
      <div className="flex items-center gap-3">
        {showMenuButton ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onMenuClick}
            className="lg:hidden"
            aria-label="Toggle menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}
        {title ? <h1 className="text-lg font-semibold text-fg-primary">{title}</h1> : null}
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        {onLogout ? (
          <Button variant="ghost" size="icon-sm" onClick={onLogout} aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </header>
  )
}

function ThemeToggle() {
  // Theme toggle will be implemented in Phase 9
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" className="text-fg-secondary">
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
