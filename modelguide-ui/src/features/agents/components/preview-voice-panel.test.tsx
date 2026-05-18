import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '~/schemas/agents'
import { PreviewVoicePanel } from './preview-voice-panel'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
const mockJson = vi.fn()
const mockTokenResponse = {
  livekitUrl: 'wss://test.livekit.cloud',
  roomName: 'preview-abc',
  token: 'test-token-123',
  sessionId: '00000000-0000-0000-0000-000000000001',
  dispatchId: 'disp_abc',
  agentName: 'preview-worker',
  profileName: 'test-agent',
  identity: 'user-xyz',
  promptLength: 24,
}

vi.mock('~/lib/api', () => ({
  api: {
    post: (url: string, options?: { json?: unknown }) => {
      mockPost(url, options?.json)
      return {
        json: () => {
          mockJson()
          return Promise.resolve(mockTokenResponse)
        },
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
    ? vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
    : vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  // @ts-expect-error — jsdom does not provide mediaDevices by default
  navigator.mediaDevices = { getUserMedia }
  // @ts-expect-error — jsdom does not provide Permissions API by default
  navigator.permissions = { query: vi.fn().mockResolvedValue({ state }) }
  return getUserMedia
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreviewVoicePanel', () => {
  it('renders nothing for non-livekit agents', () => {
    const elevenAgent = { ...configuredAgent, agentPlatform: 'elevenlabs' } as Agent
    const { container } = render(
      <PreviewVoicePanel agent={elevenAgent} instructions="x" canMutate />,
      { wrapper },
    )
    expect(container.textContent).toBe('')
  })

  it('disables Sync & Talk when LiveKit is not fully configured', () => {
    const unconfigured = { ...baseAgent } as Agent
    render(<PreviewVoicePanel agent={unconfigured} instructions="x" canMutate />, { wrapper })
    const btn = screen.getByRole('button', { name: /sync & talk/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/configure the livekit/i)).toBeInTheDocument()
  })

  it('disables Sync & Talk when there is no prompt to preview', () => {
    stubMicPermission(true)
    render(<PreviewVoicePanel agent={configuredAgent} instructions="" canMutate />, { wrapper })
    const btn = screen.getByRole('button', { name: /sync & talk/i })
    expect(btn).toBeDisabled()
    // Surface the reason so the operator knows what to do.
    expect(screen.getByText(/compile.+prompt/i)).toBeInTheDocument()
  })

  it('disables Sync & Talk for viewers (canMutate=false)', () => {
    stubMicPermission(true)
    render(<PreviewVoicePanel agent={configuredAgent} instructions="x" canMutate={false} />, {
      wrapper,
    })
    expect(screen.getByRole('button', { name: /sync & talk/i })).toBeDisabled()
  })

  it('POSTs the instructions in the body and mounts the LiveKit room', async () => {
    stubMicPermission(true)
    const prompt = 'You are Sam. Be concise.'
    render(<PreviewVoicePanel agent={configuredAgent} instructions={prompt} canMutate />, {
      wrapper,
    })

    const btn = screen.getByRole('button', { name: /sync & talk/i })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/preview-voice-token', {
        instructions: prompt,
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('lk-room')).toBeInTheDocument()
      expect(screen.getByTestId('lk-audio')).toBeInTheDocument()
    })
    // The footer surfaces the prompt length the API echoed back so the
    // operator can confirm the right prompt was used (defends against
    // silent stale-cache bugs in the compile flow).
    await waitFor(() => {
      expect(screen.getByText(/24 chars/)).toBeInTheDocument()
    })
  })

  it('surfaces a clear error when mic permission is denied', async () => {
    stubMicPermission(false)
    render(<PreviewVoicePanel agent={configuredAgent} instructions="x" canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: /sync & talk/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/microphone permission denied/i)
    })
    // Should not have spent a token dispatch once mic check failed.
    expect(mockPost).not.toHaveBeenCalled()
  })
})
