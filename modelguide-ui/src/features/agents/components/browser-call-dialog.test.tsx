/**
 * Tests for the BrowserCallDialog — the in-browser WebRTC test flow.
 *
 * The dialog hits POST /agents/:id/browser-call to get a LiveKit token,
 * then uses `livekit-client` to connect, publish the mic, and render
 * the connection state. These tests mock both the API and `livekit-client`
 * so no WebRTC or network is required.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
let mockBrowserCallResponse: unknown = {
  token: 'test.jwt.token',
  url: 'wss://test.livekit.cloud',
  roomName: 'browser-abc123',
  sessionId: '00000000-0000-0000-0000-000000000001',
  dispatchId: 'DISP_1',
}
let mockApiShouldReject: Error | null = null

vi.mock('~/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => {
      mockPost(...args)
      return {
        json: () =>
          mockApiShouldReject
            ? Promise.reject(mockApiShouldReject)
            : Promise.resolve(mockBrowserCallResponse),
      }
    },
  },
}))

// Track the Room mock so tests can trigger events.
const connectMock = vi.fn()
const disconnectMock = vi.fn()
const enableMicMock = vi.fn()
let roomEventHandlers: Record<string, (...args: unknown[]) => void> = {}

vi.mock('livekit-client', () => {
  class FakeRoom {
    localParticipant = {
      setMicrophoneEnabled: enableMicMock,
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      roomEventHandlers[event] = cb
      return this
    }
    off() {
      return this
    }
    connect(...args: unknown[]) {
      return connectMock(...args)
    }
    disconnect() {
      return disconnectMock()
    }
  }
  return {
    Room: FakeRoom,
    RoomEvent: {
      Connected: 'connected',
      Disconnected: 'disconnected',
      ConnectionStateChanged: 'connectionStateChanged',
      TrackSubscribed: 'trackSubscribed',
      ParticipantConnected: 'participantConnected',
    },
    ConnectionState: {
      Connecting: 'connecting',
      Connected: 'connected',
      Disconnected: 'disconnected',
      Reconnecting: 'reconnecting',
    },
    Track: { Source: { Microphone: 'microphone' } },
  }
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  roomEventHandlers = {}
  connectMock.mockResolvedValue(undefined)
  enableMicMock.mockResolvedValue(undefined)
  mockBrowserCallResponse = {
    token: 'test.jwt.token',
    url: 'wss://test.livekit.cloud',
    roomName: 'browser-abc123',
    sessionId: '00000000-0000-0000-0000-000000000001',
    dispatchId: 'DISP_1',
  }
  mockApiShouldReject = null
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { BrowserCallDialog } from './browser-call-dialog'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  agentId: 'agent-1',
  agentName: 'BuildPro Sam',
}

describe('BrowserCallDialog', () => {
  it('renders the dialog title in idle state', () => {
    render(<BrowserCallDialog {...defaultProps} />, { wrapper })
    expect(screen.getByText(/test voice agent/i)).toBeInTheDocument()
  })

  it('calls the browser-call endpoint when Start is clicked', async () => {
    render(<BrowserCallDialog {...defaultProps} />, { wrapper })

    fireEvent.click(screen.getByText(/start call/i))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/browser-call', {
        json: {},
      })
    })
  })

  it('connects to LiveKit with the returned token and URL', async () => {
    render(<BrowserCallDialog {...defaultProps} />, { wrapper })

    fireEvent.click(screen.getByText(/start call/i))

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith('wss://test.livekit.cloud', 'test.jwt.token')
    })
  })

  it('enables the microphone after connecting', async () => {
    render(<BrowserCallDialog {...defaultProps} />, { wrapper })

    fireEvent.click(screen.getByText(/start call/i))

    await waitFor(() => {
      expect(enableMicMock).toHaveBeenCalledWith(true)
    })
  })

  it('shows a connected state once the room emits Connected', async () => {
    render(<BrowserCallDialog {...defaultProps} />, { wrapper })
    fireEvent.click(screen.getByText(/start call/i))

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled()
    })

    // Simulate the room firing its Connected event
    roomEventHandlers.connected?.()

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument()
    })
  })

  it('disconnects the room when the user clicks End', async () => {
    render(<BrowserCallDialog {...defaultProps} />, { wrapper })
    fireEvent.click(screen.getByText(/start call/i))

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalled()
    })

    roomEventHandlers.connected?.()
    await waitFor(() => {
      expect(screen.getByText(/end call/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/end call/i))
    expect(disconnectMock).toHaveBeenCalled()
  })

  it('shows an error when the API call fails', async () => {
    mockApiShouldReject = new Error('LiveKit not configured')

    render(<BrowserCallDialog {...defaultProps} />, { wrapper })
    fireEvent.click(screen.getByText(/start call/i))

    await waitFor(() => {
      expect(screen.getByText(/livekit not configured/i)).toBeInTheDocument()
    })
  })
})
