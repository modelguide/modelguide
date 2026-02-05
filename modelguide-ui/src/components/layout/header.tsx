import { LogOut, Menu, Moon, Sun } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { useThemeStore } from '~/stores/theme'

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
  const { theme, setTheme } = useThemeStore()
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      className="text-fg-secondary"
      onClick={toggleTheme}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
