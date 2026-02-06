import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoginResponse, User } from '~/schemas/auth'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setAuth: (user: User, token: string) => void
  refreshAccessToken: () => Promise<boolean>
}

// Store-level deduplication: prevents concurrent refreshes from
// beforeLoad and afterResponse hooks from racing each other
let storeRefreshPromise: Promise<boolean> | null = null

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          credentials: 'include',
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Login failed')
        }

        const data: LoginResponse = await response.json()
        set({
          user: data.user,
          token: data.token,
          isAuthenticated: true,
        })
      },

      logout: async () => {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
          })
        } catch {
          // Best-effort — clear local state regardless
        }
        set({ user: null, token: null, isAuthenticated: false })
      },

      setAuth: (user: User, token: string) => {
        set({ user, token, isAuthenticated: true })
      },

      refreshAccessToken: async () => {
        if (storeRefreshPromise) {
          return storeRefreshPromise
        }

        storeRefreshPromise = (async () => {
          try {
            const response = await fetch('/api/auth/refresh', {
              method: 'POST',
              credentials: 'include',
            })

            if (!response.ok) {
              return false
            }

            const data: LoginResponse = await response.json()
            set({
              user: data.user,
              token: data.token,
              isAuthenticated: true,
            })
            return true
          } catch {
            return false
          }
        })().finally(() => {
          storeRefreshPromise = null
        })

        return storeRefreshPromise
      },
    }),
    {
      name: 'modelguide-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
