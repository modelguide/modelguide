import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '~/schemas/agents'
import { VoicePrototypePanel } from './voice-prototype-panel'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
const mockTokenResponse = {
  livekitUrl: 'wss://test.livekit.cloud',
  roomName: 'voice-prototype-abc',
  token: 'test-token-456',
  sessionId: '00000000-0000-0000-0000-000000000002',
  dispatchId: 'disp_xyz',
  agentName: 'voice-prototype',
  identity: 'user-xyz',
  promptChars: 412,
}

vi.mock('~/lib/api', () => ({
  api: {
    post: (url: string) => {
      mockPost(url)
      return {
        json: () => Promise.resolve(mockTokenResponse),
      }
    },
  },
}))

vi.mock('livekit-client', () => ({
  ParticipantKind: { AGENT: 'agent' },
  RoomEvent: { ParticipantConnected: 'participantConnected' },
}))

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: ReactNode }) => (
    <div data-testid="lk-room">{children}</div>
  ),
  RoomAudioRenderer: () => <div data-testid="lk-audio" />,
  useRoomContext: () => ({
    localParticipant: { setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined) },
    remoteParticipants: new Map([['agent-1', { kind: 'agent', identity: 'agent-1' }]]),
    on: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  }),
  useVoiceAssistant: () => ({ state: 'listening', audioTrack: undefined }),
}))

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

const configuredAgent: Agent = {
  ...baseAgent,
  secrets: { livekit_api_key: 'sec-1', livekit_api_secret: 'sec-2' },
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function stubMicPermission(grant = true) {
  const state: PermissionState = grant ? 'granted' : 'denied'
  const getUserMedia = grant
    ? vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      })
    : vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  // @ts-expect-error — jsdom does not provide mediaDevices by default
  navigator.mediaDevices = { getUserMedia }
  // @ts-expect-error — jsdom does not provide Permissions API by default
  navigator.permissions = {
    query: vi.fn().mockResolvedValue({ state }),
  }
  return getUserMedia
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoicePrototypePanel', () => {
  it('renders nothing for non-livekit agents', () => {
    const elevenAgent = { ...configuredAgent, agentPlatform: 'elevenlabs' } as Agent
    const { container } = render(<VoicePrototypePanel agent={elevenAgent} canMutate />, { wrapper })
    expect(container.textContent).toBe('')
  })

  it('disables the prototype button when LiveKit is not fully configured', () => {
    const unconfigured = { ...baseAgent } as Agent
    render(<VoicePrototypePanel agent={unconfigured} canMutate />, { wrapper })
    expect(screen.getByRole('button', { name: /talk to prototype/i })).toBeDisabled()
    expect(screen.getByText(/configure the livekit/i)).toBeInTheDocument()
  })

  it('blocks the prototype button when there is no compiled prompt', () => {
    // The prototype's whole job is to exercise the compiled prompt — refuse
    // to start if there isn't one and tell the operator to compile first.
    const noPrompt = { ...configuredAgent, compiledInstructions: null } as Agent
    render(<VoicePrototypePanel agent={noPrompt} canMutate />, { wrapper })
    expect(screen.getByRole('button', { name: /talk to prototype/i })).toBeDisabled()
    expect(screen.getByText(/compile the prompt first/i)).toBeInTheDocument()
  })

  it('disables the prototype button for viewers (canMutate=false)', () => {
    render(<VoicePrototypePanel agent={configuredAgent} canMutate={false} />, { wrapper })
    expect(screen.getByRole('button', { name: /talk to prototype/i })).toBeDisabled()
  })

  it('hits the prototype endpoint and mounts the LiveKit room on click', async () => {
    stubMicPermission(true)
    render(<VoicePrototypePanel agent={configuredAgent} canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: /talk to prototype/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/voice-prototype-token')
    })

    await waitFor(() => {
      expect(screen.getByTestId('lk-room')).toBeInTheDocument()
      expect(screen.getByTestId('lk-audio')).toBeInTheDocument()
    })
  })

  it('surfaces a clear error when mic permission is denied', async () => {
    stubMicPermission(false)
    render(<VoicePrototypePanel agent={configuredAgent} canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: /talk to prototype/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/microphone permission denied/i)
    })
    expect(mockPost).not.toHaveBeenCalled()
  })
})
