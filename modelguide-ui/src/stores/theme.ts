import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'dark' | 'light' | 'system'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  getResolvedTheme: () => 'dark' | 'light'
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme })
        if (typeof window !== 'undefined') {
          applyTheme(theme)
        }
      },
      getResolvedTheme: () => {
        const { theme } = get()
        if (theme === 'system' && typeof window !== 'undefined') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
        return theme === 'system' ? 'dark' : theme
      },
    }),
    {
      name: 'modelguide-theme',
      onRehydrateStorage: () => (state) => {
        if (state?.theme && typeof window !== 'undefined') {
          applyTheme(state.theme)
        }
      },
    },
  ),
)

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme

  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
}

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme, setTheme } = useThemeStore.getState()
    if (theme === 'system') {
      setTheme('system')
    }
  })
}
