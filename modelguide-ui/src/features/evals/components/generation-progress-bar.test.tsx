import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GenerationProgressBar } from './generation-progress-bar'

describe('GenerationProgressBar', () => {
  it('shows "Deriving dimensions" status text', () => {
    render(
      <GenerationProgressBar
        completed={0}
        total={0}
        accepted={0}
        rejected={0}
        status="deriving_dimensions"
      />,
    )

    expect(screen.getByText('Deriving dimensions from SOP...')).toBeInTheDocument()
  })

  it('shows generating status with progress count', () => {
    render(
      <GenerationProgressBar
        completed={5}
        total={10}
        accepted={3}
        rejected={2}
        status="generating"
      />,
    )

    expect(screen.getByText('Generating case 5/10...')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('shows completed status with accepted/rejected counts', () => {
    render(
      <GenerationProgressBar
        completed={10}
        total={10}
        accepted={8}
        rejected={2}
        status="completed"
      />,
    )

    expect(screen.getByText('Done — 8 accepted, 2 rejected')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('shows failed status text', () => {
    render(
      <GenerationProgressBar completed={0} total={0} accepted={0} rejected={0} status="failed" />,
    )

    expect(screen.getByText('Generation failed')).toBeInTheDocument()
  })

  it('hides percentage when total is 0', () => {
    render(
      <GenerationProgressBar
        completed={0}
        total={0}
        accepted={0}
        rejected={0}
        status="deriving_dimensions"
      />,
    )

    expect(screen.queryByText('%')).not.toBeInTheDocument()
  })

  it('shows accepted/rejected counts only during generating', () => {
    const { rerender } = render(
      <GenerationProgressBar
        completed={3}
        total={10}
        accepted={2}
        rejected={1}
        status="generating"
      />,
    )

    expect(screen.getByText('2 accepted')).toBeInTheDocument()
    expect(screen.getByText('1 rejected')).toBeInTheDocument()

    // Rerender as completed — counts should disappear
    rerender(
      <GenerationProgressBar
        completed={10}
        total={10}
        accepted={8}
        rejected={2}
        status="completed"
      />,
    )

    expect(screen.queryByText('8 accepted')).not.toBeInTheDocument()
  })

  it('calculates percentage correctly', () => {
    render(
      <GenerationProgressBar
        completed={3}
        total={7}
        accepted={2}
        rejected={1}
        status="generating"
      />,
    )

    // 3/7 = 42.857... → rounds to 43
    expect(screen.getByText('43%')).toBeInTheDocument()
  })
})
