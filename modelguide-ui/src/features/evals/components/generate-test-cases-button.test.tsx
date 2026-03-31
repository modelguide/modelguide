import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks ---

vi.mock('~/lib/cn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

let mockPostResponse: () => Promise<unknown> = () =>
  Promise.resolve({ taskId: 'task-1', status: 'running' })
let mockGetResponse: () => Promise<unknown> = () => Promise.resolve({})

vi.mock('~/lib/api', () => ({
  api: {
    post: () => ({ json: () => mockPostResponse() }),
    get: () => ({ json: () => mockGetResponse() }),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { toast } from 'sonner'
import { GenerateTestCasesButton } from './generate-test-cases-button'

function renderButton(props: { suiteId?: string; hasSop?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <GenerateTestCasesButton suiteId={props.suiteId ?? 'suite-1'} hasSop={props.hasSop ?? true} />
    </QueryClientProvider>,
  )
}

// --- Tests ---

describe('GenerateTestCasesButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostResponse = () => Promise.resolve({ taskId: 'task-1', status: 'running' })
    mockGetResponse = () => Promise.resolve({})
  })

  it('renders the generate button', () => {
    renderButton()

    expect(screen.getByText('Generate Cases')).toBeInTheDocument()
  })

  it('disables button when hasSop is false', () => {
    renderButton({ hasSop: false })

    const button = screen.getByRole('button', { name: /generate/i })
    expect(button).toBeDisabled()
  })

  it('enables button when hasSop is true', () => {
    renderButton({ hasSop: true })

    const button = screen.getByRole('button', { name: /generate/i })
    expect(button).not.toBeDisabled()
  })

  it('shows tooltip for disabled state', () => {
    renderButton({ hasSop: false })

    const button = screen.getByRole('button', { name: /generate/i })
    expect(button).toHaveAttribute('title', 'Link a SOP to generate test cases')
  })

  it('shows tooltip for enabled state', () => {
    renderButton({ hasSop: true })

    const button = screen.getByRole('button', { name: /generate/i })
    expect(button).toHaveAttribute('title', 'Generate synthetic test cases from SOP')
  })

  it('shows progress bar after successful mutation', async () => {
    mockGetResponse = () =>
      Promise.resolve({
        id: 'task-1',
        status: 'running',
        progress: {
          status: 'generating',
          completed: 2,
          total: 5,
          accepted: 1,
          rejected: 1,
        },
      })

    renderButton()

    await act(async () => {
      screen.getByRole('button', { name: /generate/i }).click()
    })

    await waitFor(() => {
      expect(screen.getByText(/Generating case/)).toBeInTheDocument()
    })
  })

  it('shows error toast when mutation fails with JSON body', async () => {
    mockPostResponse = () =>
      Promise.reject({
        response: {
          status: 400,
          json: () => Promise.resolve({ message: 'Suite has no linked SOP' }),
        },
      })

    renderButton()

    await act(async () => {
      screen.getByRole('button', { name: /generate/i }).click()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Suite has no linked SOP')
    })
  })

  it('shows HTTP status in error toast when body is not JSON', async () => {
    mockPostResponse = () =>
      Promise.reject({
        response: {
          status: 502,
          json: () => Promise.reject(new Error('not json')),
        },
      })

    renderButton()

    await act(async () => {
      screen.getByRole('button', { name: /generate/i }).click()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to start generation (HTTP 502)')
    })
  })

  it('shows generic error toast when error has no response', async () => {
    mockPostResponse = () => Promise.reject(new Error('Network error'))

    renderButton()

    await act(async () => {
      screen.getByRole('button', { name: /generate/i }).click()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to start test case generation')
    })
  })
})
