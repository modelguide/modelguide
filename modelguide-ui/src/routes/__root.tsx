/// <reference types="vite/client" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import { HTTPError } from 'ky'
import { useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import appCss from '~/styles/app.css?url'

function handleGlobalError(error: unknown) {
  if (error instanceof HTTPError) {
    if (error.response.status === 403) {
      toast.error("You don't have permission to perform this action")
    } else if (error.response.status >= 500) {
      toast.error('Something went wrong. Please try again.')
    }
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
    mutations: {
      onError: handleGlobalError,
    },
  },
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'ModelGuide Dashboard' },
      { name: 'theme-color', content: '#09090b' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Syne:wght@500;600;700;800&display=swap',
      },
    ],
  }),
  component: RootComponent,
})

const MSW_READY_TIMEOUT_MS = 2000

function RootComponent() {
  const [mocksReady, setMocksReady] = useState(!import.meta.env.DEV)

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return

    let cancelled = false
    const timeoutId = setTimeout(() => {
      if (!cancelled) setMocksReady(true)
    }, MSW_READY_TIMEOUT_MS)

    async function initMocks() {
      try {
        const { worker } = await import('~/mocks/browser')
        await worker.start({
          onUnhandledRequest: 'bypass',
          serviceWorker: {
            url: '/mockServiceWorker.js',
          },
        })
        if (!cancelled) {
          console.log('[MSW] Mock service worker started')
          setMocksReady(true)
        }
      } catch (error) {
        console.warn('[MSW] Mock service worker failed (app will use real API):', error)
        if (!cancelled) setMocksReady(true)
      }
    }
    initMocks()
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [])

  if (!mocksReady) {
    return (
      <RootDocument>
        <div className="flex min-h-screen items-center justify-center bg-bg-base">
          <div className="text-fg-muted">Loading...</div>
        </div>
      </RootDocument>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  )
}
