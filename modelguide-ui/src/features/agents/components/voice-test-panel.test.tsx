import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '~/schemas/agents'
import { VoiceTestPanel } from './voice-test-panel'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
const mockTokenResponse = {
  livekitUrl: 'wss://test.livekit.cloud',
  roomName: 'voice-test-abc',
  token: 'test-token-123',
  sessionId: '00000000-0000-0000-0000-000000000001',
  dispatchId: 'disp_abc',
  agentName: 'test-agent',
  identity: 'user-xyz',
}

vi.mock('~/lib/api', () => ({
  api: {
    post: (url: string) => {
      mockPost(url)
      return { json: () => Promise.resolve(mockTokenResponse) }
    },
  },
}))

const mockRoomConnect = vi.fn().mockResolvedValue(undefined)
const mockRoomDisconnect = vi.fn().mockResolvedValue(undefined)
const mockPublishTrack = vi.fn().mockResolvedValue(undefined)

vi.mock('livekit-client', () => {
  class Room {
    localParticipant = { publishTrack: mockPublishTrack }
    connect = mockRoomConnect
    disconnect = mockRoomDisconnect
    on = vi.fn().mockReturnThis()
  }
  return {
    Room,
    RoomEvent: {
      ConnectionStateChanged: 'connectionStateChanged',
      ParticipantConnected: 'participantConnected',
      TrackSubscribed: 'trackSubscribed',
    },
    ConnectionState: { Disconnected: 'disconnected' },
    Track: { Kind: { Audio: 'audio' } },
    createLocalAudioTrack: vi.fn(() =>
      Promise.resolve({ stop: vi.fn(), mute: vi.fn(), unmute: vi.fn() }),
    ),
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseAgent: Agent = {
  id: 'agent-1',
  name: 'Test Agent',
  slug: 'test-agent',
  description: null,
  modality: 'voice',
  modelFamily: 'gpt',
  agentPlatform: 'livekit',
  isActive: true,
  evalSuiteCount: 0,
  promptConfig: {},
  metadata: { livekit: { url: 'wss://test.livekit.cloud', agentName: 'test-agent' } },
  hasElevenLabsKey: false,
  hasWebhookSecret: false,
  keyPrefix: null,
  integrationUrls: undefined,
  compiledInstructions: 'You are a voice agent. Be helpful.',
  compiledAt: '2026-04-01T00:00:00Z',
  compiledFrom: null,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
}

// `secrets` is tacked on by the API response but not part of the base schema.
// Cast through unknown to satisfy Agent's shape while still exercising the
// panel's secrets lookup branch.
const configuredAgent = {
  ...baseAgent,
  secrets: { livekit_api_key: 'sec-1', livekit_api_secret: 'sec-2' },
} as unknown as Agent

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceTestPanel', () => {
  it('renders nothing for non-livekit agents', () => {
    const elevenAgent = { ...configuredAgent, agentPlatform: 'elevenlabs' } as Agent
    const { container } = render(<VoiceTestPanel agent={elevenAgent} canMutate />, { wrapper })
    expect(container.textContent).toBe('')
  })

  it('disables the talk button when LiveKit is not fully configured', () => {
    const unconfigured = { ...baseAgent } as Agent
    render(<VoiceTestPanel agent={unconfigured} canMutate />, { wrapper })
    const btn = screen.getByRole('button', { name: /talk to agent/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/configure the livekit/i)).toBeInTheDocument()
  })

  it('disables the talk button when no compiled prompt exists', () => {
    const noPrompt = { ...configuredAgent, compiledInstructions: null } as Agent
    render(<VoiceTestPanel agent={noPrompt} canMutate />, { wrapper })
    const btn = screen.getByRole('button', { name: /talk to agent/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/compile the prompt first/i)).toBeInTheDocument()
  })

  it('disables the talk button for viewers (canMutate=false)', () => {
    render(<VoiceTestPanel agent={configuredAgent} canMutate={false} />, { wrapper })
    expect(screen.getByRole('button', { name: /talk to agent/i })).toBeDisabled()
  })

  it('fetches a token and connects to the LiveKit room when clicked', async () => {
    render(<VoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })

    const btn = screen.getByRole('button', { name: /talk to agent/i })
    expect(btn).not.toBeDisabled()

    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/voice-test-token')
    })
    await waitFor(() => {
      expect(mockRoomConnect).toHaveBeenCalledWith('wss://test.livekit.cloud', 'test-token-123')
    })
    await waitFor(() => {
      expect(mockPublishTrack).toHaveBeenCalled()
    })
    // Once the mic is published, the UI should expose hang-up controls.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /hang up/i })).toBeInTheDocument()
    })
  })
})
