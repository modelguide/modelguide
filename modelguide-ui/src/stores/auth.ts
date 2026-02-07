import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getApiBaseUrl } from '~/lib/api-base'
import type { AuthResponse, User } from '~/schemas/auth'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  requestMagicLink: (email: string) => Promise<void>
  verifyToken: (token: string) => Promise<void>
  logout: () => Promise<void>
  setAuth: (user: User, token: string) => void
  refreshAccessToken: () => Promise<boolean>
}

// Store-level deduplication: prevents concurrent refreshes from
// beforeLoad and afterResponse hooks from racing each other
let storeRefreshPromise: Promise<boolean> | null = null

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      requestMagicLink: async (email: string) => {
        const baseUrl = getApiBaseUrl()
        const response = await fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
          credentials: 'include',
        })

        if (!response.ok) {
          let message = 'Failed to send magic link'
          try {
            const error = await response.json()
            message = error.message || message
          } catch {
            // Non-JSON error response (e.g., 502 gateway timeout)
          }
          throw new Error(message)
        }
      },

      verifyToken: async (magicToken: string) => {
        const baseUrl = getApiBaseUrl()
        const response = await fetch(
          `${baseUrl}/auth/verify?token=${encodeURIComponent(magicToken)}`,
          {
            method: 'GET',
            credentials: 'include',
          },
        )

        if (!response.ok) {
          let message = 'Verification failed'
          try {
            const error = await response.json()
            message = error.message || message
          } catch {
            // Non-JSON error response (e.g., 502 gateway timeout)
          }
          throw new Error(message)
        }

        const data: AuthResponse = await response.json()
        set({
          user: data.user,
          token: data.token,
          isAuthenticated: true,
        })
      },

      logout: async () => {
        const baseUrl = getApiBaseUrl()
        try {
          await fetch(`${baseUrl}/auth/logout`, {
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
            const baseUrl = getApiBaseUrl()
            const response = await fetch(`${baseUrl}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
            })

            if (!response.ok) {
              return false
            }

            const data: AuthResponse = await response.json()
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
