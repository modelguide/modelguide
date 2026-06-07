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
    post: (url: string, opts?: { json?: unknown }) => {
      // Capture body so prompt-sync tests can assert the flag was sent.
      // ky's API is `post(url, { json: body })` — we unwrap once so the
      // assertion reads naturally as `(url, { useCompiledPrompt: ... })`.
      mockPost(url, opts?.json)
      return {
        json: () => Promise.resolve(mockTokenResponse),
      }
    },
  },
}))

// Mock livekit-client — we only need the enum values used at the call site.
vi.mock('livekit-client', () => ({
  ParticipantKind: { AGENT: 'agent' },
  RoomEvent: { ParticipantConnected: 'participantConnected' },
}))

// Mock @livekit/components-react. We render the LiveKitRoom's children so the
// inner RoomController still mounts under a mocked room context. useVoiceAssistant
// returns a static "listening" state.
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

  it('allows talk without a compiled prompt (worker uses its baked-in profile)', () => {
    const noPrompt = { ...configuredAgent, compiledInstructions: null } as Agent
    stubMicPermission(true)
    render(<VoiceTestPanel agent={noPrompt} canMutate />, { wrapper })
    // Button enabled — the worker's profile owns the prompt; the voice-test
    // flow doesn't inject one.
    expect(screen.getByRole('button', { name: /talk to agent/i })).not.toBeDisabled()
  })

  it('disables the talk button for viewers (canMutate=false)', () => {
    stubMicPermission(true)
    render(<VoiceTestPanel agent={configuredAgent} canMutate={false} />, { wrapper })
    expect(screen.getByRole('button', { name: /talk to agent/i })).toBeDisabled()
  })

  it('fetches a token and mounts the LiveKit room on click', async () => {
    stubMicPermission(true)
    render(<VoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })

    const btn = screen.getByRole('button', { name: /talk to agent/i })
    expect(btn).not.toBeDisabled()

    fireEvent.click(btn)

    await waitFor(() => {
      // Default behavior — body says the worker should use its baked-in
      // profile prompt (ADR-014). The flag is included explicitly false
      // so a future server-side default change can't silently flip the
      // behavior of an idle dashboard.
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/voice-test-token', {
        useCompiledPrompt: false,
      })
    })
    // Once we have a token, <LiveKitRoom> mounts.
    await waitFor(() => {
      expect(screen.getByTestId('lk-room')).toBeInTheDocument()
      expect(screen.getByTestId('lk-audio')).toBeInTheDocument()
    })
    // Session id appears in the footer for debugging.
    await waitFor(() => {
      expect(screen.getByText(/Session/)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------
  // Prompt-sync prototype (ADR-015): a toggle on the panel asks the
  // server to ship the agent's compiled prompt to the worker via
  // dispatch metadata. The toggle is only useful when a compiled prompt
  // actually exists.
  // --------------------------------------------------------------------

  it('shows the prompt-sync toggle when a compiled prompt exists', () => {
    stubMicPermission(true)
    render(<VoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })
    const toggle = screen.getByRole('checkbox', { name: /use latest compiled prompt/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).not.toBeDisabled()
  })

  it('disables the prompt-sync toggle when there is no compiled prompt', () => {
    stubMicPermission(true)
    const noPrompt = { ...configuredAgent, compiledInstructions: null } as Agent
    render(<VoiceTestPanel agent={noPrompt} canMutate />, { wrapper })
    const toggle = screen.getByRole('checkbox', { name: /use latest compiled prompt/i })
    expect(toggle).toBeDisabled()
  })

  it('sends useCompiledPrompt=true when the toggle is enabled', async () => {
    stubMicPermission(true)
    render(<VoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('checkbox', { name: /use latest compiled prompt/i }))
    fireEvent.click(screen.getByRole('button', { name: /talk to agent/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/voice-test-token', {
        useCompiledPrompt: true,
      })
    })
  })

  it('surfaces a clear error when mic permission is denied', async () => {
    stubMicPermission(false)
    render(<VoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: /talk to agent/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/microphone permission denied/i)
    })
    // Should not have attempted to fetch the token once the mic check failed.
    expect(mockPost).not.toHaveBeenCalled()
  })
})
