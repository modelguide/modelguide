/**
 * PrototypeVoiceTestPanel tests — ADR-015 prototype "compile → sync → talk" flow.
 *
 * Unlike the production VoiceTestPanel (which dispatches the worker as-is and
 * lets the baked-in profile own the prompt), this panel:
 *   1. Compiles the agent (POST /agents/:id/compile) to refresh
 *      compiledInstructions on the server.
 *   2. Dispatches the prototype worker with the refreshed prompt embedded
 *      in metadata (POST /agents/:id/prototype-voice-test-token).
 *   3. Joins the room from the browser via WebRTC.
 *
 * The compile step is the "Sync" half of the button — it guarantees the worker
 * is dispatched with the latest text without requiring the operator to click
 * "Compile" elsewhere first.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '~/schemas/agents'
import { PrototypeVoiceTestPanel } from './prototype-voice-test-panel'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
const mockTokenResponse = {
  livekitUrl: 'wss://test.livekit.cloud',
  roomName: 'proto-abc',
  token: 'test-token-123',
  sessionId: '00000000-0000-0000-0000-000000000001',
  dispatchId: 'disp_abc',
  agentName: 'modelguide-prototype',
  profileName: 'test-agent',
  identity: 'user-xyz',
  instructionsHash: 'deadbeef',
  instructionsLength: 42,
}
const mockCompileResponse = {
  agentId: 'agent-1',
  compiledAt: '2026-04-27T00:00:00Z',
  compiledFrom: { sopIds: [] },
  compiledPrompt: 'Refreshed prompt.',
  metadata: { warnings: [] },
}

vi.mock('~/lib/api', () => ({
  api: {
    post: (url: string) => {
      mockPost(url)
      const isCompile = url.endsWith('/compile')
      return {
        json: () => Promise.resolve(isCompile ? mockCompileResponse : mockTokenResponse),
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
  metadata: { livekit: { url: 'wss://test.livekit.cloud', agentName: 'modelguide-prototype' } },
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

describe('PrototypeVoiceTestPanel', () => {
  it('renders nothing for non-livekit agents', () => {
    const elevenAgent = { ...configuredAgent, agentPlatform: 'elevenlabs' } as Agent
    const { container } = render(<PrototypeVoiceTestPanel agent={elevenAgent} canMutate />, {
      wrapper,
    })
    expect(container.textContent).toBe('')
  })

  it('disables the Sync & Test button when LiveKit is not configured', () => {
    const unconfigured = { ...baseAgent } as Agent
    render(<PrototypeVoiceTestPanel agent={unconfigured} canMutate />, { wrapper })
    const btn = screen.getByRole('button', { name: /sync.*test/i })
    expect(btn).toBeDisabled()
  })

  it('disables the Sync & Test button for viewers (canMutate=false)', () => {
    stubMicPermission(true)
    render(<PrototypeVoiceTestPanel agent={configuredAgent} canMutate={false} />, { wrapper })
    expect(screen.getByRole('button', { name: /sync.*test/i })).toBeDisabled()
  })

  it('compiles, then dispatches with the refreshed prompt, then mounts the room', async () => {
    stubMicPermission(true)
    render(<PrototypeVoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: /sync.*test/i }))

    // Compile call comes first, then the prototype-voice-test-token dispatch.
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/compile')
    })
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/prototype-voice-test-token')
    })
    // Order check: compile must come before dispatch.
    const calls = mockPost.mock.calls.map((c) => c[0])
    expect(calls.indexOf('agents/agent-1/compile')).toBeLessThan(
      calls.indexOf('agents/agent-1/prototype-voice-test-token'),
    )

    // Once the token is back, the LiveKit room mounts.
    await waitFor(() => {
      expect(screen.getByTestId('lk-room')).toBeInTheDocument()
    })
    // Prompt fingerprint surfaces in the footer so operators can confirm the
    // sync actually pushed the new text.
    await waitFor(() => {
      expect(screen.getByText(/deadbeef/)).toBeInTheDocument()
    })
  })

  it('does not dispatch the worker when mic permission is denied', async () => {
    stubMicPermission(false)
    render(<PrototypeVoiceTestPanel agent={configuredAgent} canMutate />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: /sync.*test/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/microphone/i)
    })
    expect(mockPost).not.toHaveBeenCalled()
  })
})
