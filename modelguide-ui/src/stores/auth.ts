import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getApiBaseUrl } from '~/lib/api-base'
import type { AuthResponse, User } from '~/schemas/auth'

export const LOGIN_RESULT = {
  AUTHENTICATED: 'authenticated',
  MAGIC_LINK_SENT: 'magic_link_sent',
} as const

export type LoginResult = (typeof LOGIN_RESULT)[keyof typeof LOGIN_RESULT]

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string) => Promise<LoginResult>
  verifyToken: (token: string) => Promise<void>
  logout: () => Promise<void>
  setAuth: (user: User, token: string) => void
  refreshAccessToken: () => Promise<boolean>
  tryRefresh: () => Promise<'success' | 'auth_error' | 'network_error'>
}

// Store-level deduplication: prevents concurrent refreshes from
// beforeLoad and afterResponse hooks from racing each other
let storeRefreshPromise: Promise<boolean> | null = null

// Hydration tracking — onRehydrateStorage fires regardless of whether
// the persist API is attached (which it isn't during SSR because
// localStorage is unavailable and the middleware early-returns).
let hydrated = false
const hydrationListeners = new Set<() => void>()

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: async (email: string) => {
        const baseUrl = getApiBaseUrl()
        const response = await fetch(`${baseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
          credentials: 'include',
        })

        if (response.status === 200) {
          // Demo viewer — instant auth
          const data: AuthResponse = await response.json()
          set({
            user: data.user,
            token: data.token,
            isAuthenticated: true,
          })
          return LOGIN_RESULT.AUTHENTICATED
        }

        if (response.status === 202) {
          return LOGIN_RESULT.MAGIC_LINK_SENT
        }

        // Error response
        let message = 'Login failed'
        try {
          const error = await response.json()
          message = error.message || message
        } catch {
          // Non-JSON error response (e.g., 502 gateway timeout)
        }
        throw new Error(message)
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

      // For route guards that need to distinguish failure reasons.
      // Delegates to refreshAccessToken() to share storeRefreshPromise dedup —
      // prevents double refresh when beforeLoad and ky 401 interceptor race.
      tryRefresh: async () => {
        try {
          const success = await get().refreshAccessToken()
          return success ? 'success' : 'auth_error'
        } catch {
          return 'network_error'
        }
      },
    }),
    {
      name: 'modelguide-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => () => {
        hydrated = true
        for (const fn of hydrationListeners) fn()
        hydrationListeners.clear()
      },
    },
  ),
)

export function waitForHydration(): Promise<void> {
  if (hydrated) return Promise.resolve()

  return new Promise<void>((resolve) => {
    // SSR: no localStorage → persist middleware skips hydration entirely.
    // Resolve immediately so the route guard reads defaults and redirects to /login.
    if (typeof window === 'undefined') {
      resolve()
      return
    }

    const done = () => {
      clearTimeout(timer)
      hydrationListeners.delete(done)
      resolve()
    }

    hydrationListeners.add(done)

    // Safety net: resolve after 2s even if hydration stalls.
    // Unhydrated state = defaults (isAuthenticated: false) → login redirect.
    const timer = setTimeout(done, 2000)
  })
}
