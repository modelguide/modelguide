import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  MINIMAL_PROMPT,
  MULTILINE_PROMPT,
  SAMPLE_PROMPT,
} from '../../../../test/prompt-compiler-fixtures'
import { PromptViewer } from './prompt-viewer'

// ---------------------------------------------------------------------------
// Structured view — section parsing & rendering
// ---------------------------------------------------------------------------

describe('PromptViewer', () => {
  describe('structured view (default)', () => {
    it('renders preamble text outside any section', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      expect(screen.getByText(/customer support agent for GlowBox/)).toBeInTheDocument()
    })

    it('renders section headings from ## markdown', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      expect(screen.getByText('Workflow: WISMO')).toBeInTheDocument()
      expect(screen.getByText('Available Tools')).toBeInTheDocument()
      expect(screen.getByText('Guardrails')).toBeInTheDocument()
      expect(screen.getByText('Escalation Triggers')).toBeInTheDocument()
    })

    it('renders tool names as pills, stripping markdown list prefix and descriptions', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      // Tool names appear in the Tools section (and possibly in Steps too)
      expect(screen.getAllByText('glowbox_store_lookup_order').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('glowbox_store_track_shipment')).toBeInTheDocument()
      // Tool with description after em-dash — should show only the name
      expect(screen.getAllByText('helpdesk_create_ticket').length).toBeGreaterThanOrEqual(1)
      expect(screen.queryByText(/Create a support ticket/)).not.toBeInTheDocument()
    })

    it('renders guardrail priority badges', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      expect(screen.getByText('Critical')).toBeInTheDocument()
      expect(screen.getByText('High')).toBeInTheDocument()
      expect(screen.getByText('Medium')).toBeInTheDocument()
    })

    it('renders guardrail rules with bold labels', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      expect(screen.getByText('Never share PII')).toBeInTheDocument()
      expect(screen.getByText('Verify identity')).toBeInTheDocument()
    })

    it('renders workflow steps with numbered badges', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      expect(screen.getByText('Greet the customer')).toBeInTheDocument()
      expect(screen.getByText('Ask for their order number')).toBeInTheDocument()
      expect(screen.getByText('Provide status update')).toBeInTheDocument()
    })

    it('renders tool names on steps that reference tools', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      // Step 3 has a tool reference: "Look up the order → `glowbox_store_lookup_order`"
      expect(screen.getByText('Look up the order')).toBeInTheDocument()
      // Tool name appears both in the step pill and the tools section
      expect(screen.getAllByText('glowbox_store_lookup_order').length).toBeGreaterThanOrEqual(2)
    })

    it('renders escalation triggers as list items', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      expect(screen.getByText('Customer requests a supervisor')).toBeInTheDocument()
      expect(screen.getByText('Three failed verification attempts')).toBeInTheDocument()
    })

    it('handles content with no sections gracefully', () => {
      render(<PromptViewer content={MINIMAL_PROMPT} />)

      expect(screen.getByText('You are a helpful assistant.')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // View toggle
  // ---------------------------------------------------------------------------

  describe('view toggle', () => {
    it('defaults to structured view', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      // Structured view shows section headings
      expect(screen.getByText('Workflow: WISMO')).toBeInTheDocument()
    })

    it('switches to raw view on tab click', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      fireEvent.click(screen.getByText('Raw'))

      // Raw view shows line numbers and copy button
      expect(screen.getByLabelText('Copy to clipboard')).toBeInTheDocument()
    })

    it('switches back to structured view', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} />)

      fireEvent.click(screen.getByText('Raw'))
      fireEvent.click(screen.getByText('Structured'))

      // Section headings are back
      expect(screen.getByText('Workflow: WISMO')).toBeInTheDocument()
    })

    it('respects defaultView="raw"', () => {
      render(<PromptViewer content={SAMPLE_PROMPT} defaultView="raw" />)

      expect(screen.getByLabelText('Copy to clipboard')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Raw view
  // ---------------------------------------------------------------------------

  describe('raw view', () => {
    it('shows line numbers for each line', () => {
      render(<PromptViewer content={'Line one\nLine two\nLine three'} defaultView="raw" />)

      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('copies content to clipboard on button click', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      const content = 'Hello world'
      render(<PromptViewer content={content} defaultView="raw" />)

      fireEvent.click(screen.getByLabelText('Copy to clipboard'))

      expect(writeText).toHaveBeenCalledWith(content)
    })
  })

  // ---------------------------------------------------------------------------
  // Truncation
  // ---------------------------------------------------------------------------

  describe('truncation', () => {
    it('shows "Show full prompt" button when content exceeds maxLines', () => {
      render(<PromptViewer content={MULTILINE_PROMPT} maxLines={5} />)

      expect(screen.getByText('Show full prompt (30 lines)')).toBeInTheDocument()
    })

    it('does not show truncation button when content fits within maxLines', () => {
      render(<PromptViewer content={MINIMAL_PROMPT} maxLines={5} />)

      expect(screen.queryByText(/Show full prompt/)).not.toBeInTheDocument()
    })

    it('expands content when "Show full prompt" is clicked', () => {
      render(<PromptViewer content={MULTILINE_PROMPT} maxLines={5} defaultView="raw" />)

      fireEvent.click(screen.getByText('Show full prompt (30 lines)'))

      // After expansion, button disappears and all lines are visible
      expect(screen.queryByText(/Show full prompt/)).not.toBeInTheDocument()
      expect(screen.getByText('30')).toBeInTheDocument()
    })

    it('does not truncate when maxLines is not set', () => {
      render(<PromptViewer content={MULTILINE_PROMPT} defaultView="raw" />)

      expect(screen.queryByText(/Show full prompt/)).not.toBeInTheDocument()
      expect(screen.getByText('30')).toBeInTheDocument()
    })
  })
})
