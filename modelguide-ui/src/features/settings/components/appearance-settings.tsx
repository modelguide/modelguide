import { Monitor, Moon, Sun } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { useThemeStore } from '~/stores/theme'

const themes = [
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'system' as const, label: 'System', icon: Monitor },
]

export function AppearanceSettings() {
  const { theme, setTheme } = useThemeStore()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 font-sans text-sm text-fg-secondary">
          Choose how the dashboard looks to you. Select a theme or sync with your system settings.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              key={value}
              onClick={() => setTheme(value)}
              className={`
                flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition
                ${
                  theme === value
                    ? 'border-brand bg-brand/10'
                    : 'border-fg-subtle/20 bg-bg-base hover:border-brand/50'
                }
              `}
            >
              <Icon className={`h-5 w-5 ${theme === value ? 'text-brand' : 'text-fg-muted'}`} />
              <span
                className={`font-mono text-sm ${
                  theme === value ? 'text-brand' : 'text-fg-secondary'
                }`}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
