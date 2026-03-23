import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SAMPLE_PROMPT,
  makeAgent,
  makeCompiledFrom,
} from '../../../../test/prompt-compiler-fixtures'
import { CompiledPromptCard } from './compiled-prompt-card'

// Mock dialog methods (jsdom limitation)
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

vi.mock('~/lib/api', () => ({
  api: {
    get: vi.fn().mockReturnValue({
      json: () => Promise.resolve({ data: [] }),
    }),
    post: vi.fn().mockReturnValue({
      json: () => Promise.resolve({}),
    }),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('CompiledPromptCard', () => {
  describe('empty state', () => {
    it('shows empty state when agent has no compiled prompt', () => {
      render(<CompiledPromptCard agent={makeAgent()} canMutate={false} />, { wrapper })

      expect(screen.getByText('Compiled Prompt')).toBeInTheDocument()
      expect(screen.getByText('No compiled prompt yet')).toBeInTheDocument()
    })

    it('shows explanation text for admins in empty state', () => {
      render(<CompiledPromptCard agent={makeAgent()} canMutate />, { wrapper })

      expect(screen.getByText(/Compile a prompt from an assigned SOP/)).toBeInTheDocument()
    })

    it('hides explanation text for non-admins in empty state', () => {
      render(<CompiledPromptCard agent={makeAgent()} canMutate={false} />, { wrapper })

      expect(screen.queryByText(/Compile a prompt from an assigned SOP/)).not.toBeInTheDocument()
    })

    it('shows "Compile Prompt" button for admins', () => {
      render(<CompiledPromptCard agent={makeAgent()} canMutate />, { wrapper })

      expect(screen.getByText('Compile Prompt')).toBeInTheDocument()
    })

    it('hides action button for non-admins', () => {
      render(<CompiledPromptCard agent={makeAgent()} canMutate={false} />, { wrapper })

      expect(screen.queryByText('Compile Prompt')).not.toBeInTheDocument()
      expect(screen.queryByText('Recompile')).not.toBeInTheDocument()
    })
  })

  describe('compiled state', () => {
    const compiledAgent = makeAgent({
      compiledInstructions: SAMPLE_PROMPT,
      compiledAt: '2026-03-19T16:00:00Z',
      compiledFrom: makeCompiledFrom(),
    })

    it('renders compiled prompt content', () => {
      render(<CompiledPromptCard agent={compiledAgent} canMutate={false} />, { wrapper })

      // PromptViewer renders section headings from compiled content
      expect(screen.getByText('Workflow: WISMO')).toBeInTheDocument()
    })

    it('shows summary bar with SOP name', () => {
      render(<CompiledPromptCard agent={compiledAgent} canMutate={false} />, { wrapper })

      expect(screen.getByText('WISMO Email Flow')).toBeInTheDocument()
    })

    it('shows "Recompile" button instead of "Compile Prompt" for admins', () => {
      render(<CompiledPromptCard agent={compiledAgent} canMutate />, { wrapper })

      expect(screen.getByText('Recompile')).toBeInTheDocument()
      expect(screen.queryByText('Compile Prompt')).not.toBeInTheDocument()
    })
  })

  describe('compile dialog', () => {
    it('opens compile dialog when button is clicked', () => {
      render(<CompiledPromptCard agent={makeAgent()} canMutate />, { wrapper })

      fireEvent.click(screen.getByRole('button', { name: 'Compile Prompt' }))

      // Dialog opens — verify its unique description text and controls are present
      expect(
        screen.getByText('Select an SOP and preview the compiled system prompt.'),
      ).toBeInTheDocument()
      expect(screen.getByText('Preview')).toBeInTheDocument()
      expect(screen.getByText('Apply')).toBeInTheDocument()
    })
  })
})
