/**
 * PromptLabPanel — POC prompt-iteration surface (ADR-015).
 *
 * The standard VoiceTestPanel tests the "talk to the deployed worker"
 * flow. This panel tests the override path: type a prompt, click
 * "Sync & Talk", the dispatch metadata carries `prompt_override`, the
 * worker uses it as the agent's instructions for the session.
 *
 * Mocks mirror voice-test-panel.test.tsx so both panels exercise the
 * same LiveKit stubs.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '~/schemas/agents'
import { PromptLabPanel } from './prompt-lab-panel'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()
let lastPostBody: unknown = null

const mockTokenResponse = {
  livekitUrl: 'wss://test.livekit.cloud',
  roomName: 'voice-test-abc',
  token: 'test-token-123',
  sessionId: '00000000-0000-0000-0000-000000000001',
  dispatchId: 'disp_abc',
  agentName: 'test-agent',
  profileName: 'test-agent',
  identity: 'user-xyz',
}

vi.mock('~/lib/api', () => ({
  api: {
    post: (url: string, options?: { json?: unknown }) => {
      mockPost(url, options?.json)
      lastPostBody = options?.json ?? null
      return { json: () => Promise.resolve(mockTokenResponse) }
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

const configuredAgent: Agent = {
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
  secrets: { livekit_api_key: 'sec-1', livekit_api_secret: 'sec-2' },
  hasElevenLabsKey: false,
  hasWebhookSecret: false,
  keyPrefix: null,
  integrationUrls: undefined,
  compiledInstructions: 'You are a helpful assistant.',
  compiledAt: '2026-04-01T00:00:00Z',
  compiledFrom: null,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
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
  // @ts-expect-error — jsdom lacks mediaDevices
  navigator.mediaDevices = { getUserMedia }
  // @ts-expect-error — jsdom lacks Permissions API
  navigator.permissions = { query: vi.fn().mockResolvedValue({ state }) }
  return getUserMedia
}

beforeEach(() => {
  vi.clearAllMocks()
  lastPostBody = null
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptLabPanel', () => {
  it('renders nothing for non-livekit agents', () => {
    const elevenAgent = { ...configuredAgent, agentPlatform: 'elevenlabs' } as Agent
    const { container } = render(<PromptLabPanel agent={elevenAgent} canMutate />, { wrapper })
    expect(container.textContent).toBe('')
  })

  it("seeds the textarea with the agent's compiledInstructions", () => {
    render(<PromptLabPanel agent={configuredAgent} canMutate />, { wrapper })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('You are a helpful assistant.')
  })

  it('falls back to an empty textarea when the agent has no compiled prompt', () => {
    const noPrompt = { ...configuredAgent, compiledInstructions: null } as Agent
    render(<PromptLabPanel agent={noPrompt} canMutate />, { wrapper })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('disables Sync & Talk when the textarea is empty / whitespace', () => {
    const noPrompt = { ...configuredAgent, compiledInstructions: null } as Agent
    render(<PromptLabPanel agent={noPrompt} canMutate />, { wrapper })
    const btn = screen.getByRole('button', { name: /sync & talk/i })
    expect(btn).toBeDisabled()
  })

  it('disables Sync & Talk for viewers (canMutate=false)', () => {
    render(<PromptLabPanel agent={configuredAgent} canMutate={false} />, { wrapper })
    expect(screen.getByRole('button', { name: /sync & talk/i })).toBeDisabled()
  })

  it('warns when LiveKit is not configured and disables the action', () => {
    const unconfigured = { ...configuredAgent, secrets: {} } as Agent
    render(<PromptLabPanel agent={unconfigured} canMutate />, { wrapper })
    expect(screen.getByText(/configure the livekit/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sync & talk/i })).toBeDisabled()
  })

  it('POSTs the edited prompt as the request body and mounts the room', async () => {
    stubMicPermission(true)
    render(<PromptLabPanel agent={configuredAgent} canMutate />, { wrapper })

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'You are a pirate. Answer in pirate.' } })

    fireEvent.click(screen.getByRole('button', { name: /sync & talk/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('agents/agent-1/voice-test-prompt', {
        prompt: 'You are a pirate. Answer in pirate.',
      })
    })
    expect(lastPostBody).toEqual({ prompt: 'You are a pirate. Answer in pirate.' })

    await waitFor(() => {
      expect(screen.getByTestId('lk-room')).toBeInTheDocument()
      expect(screen.getByTestId('lk-audio')).toBeInTheDocument()
    })
  })

  it('surfaces a clear error when mic permission is denied', async () => {
    stubMicPermission(false)
    render(<PromptLabPanel agent={configuredAgent} canMutate />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /sync & talk/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/microphone permission denied/i)
    })
    expect(mockPost).not.toHaveBeenCalled()
  })
})
