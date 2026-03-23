import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeCompiledFrom } from '../../../../test/prompt-compiler-fixtures'
import { CompileSummaryBar } from './compile-summary-bar'

describe('CompileSummaryBar', () => {
  it('renders SOP name', () => {
    render(
      <CompileSummaryBar
        compiledFrom={makeCompiledFrom({ sopName: 'WISMO Flow' })}
        promptLength={2450}
      />,
    )

    expect(screen.getByText('WISMO Flow')).toBeInTheDocument()
  })

  it('renders step count', () => {
    render(
      <CompileSummaryBar compiledFrom={makeCompiledFrom({ stepCount: 8 })} promptLength={1000} />,
    )

    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('steps')).toBeInTheDocument()
  })

  it('renders tool count', () => {
    render(
      <CompileSummaryBar compiledFrom={makeCompiledFrom({ toolCount: 5 })} promptLength={1000} />,
    )

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('tools')).toBeInTheDocument()
  })

  it('formats prompt length with locale separators', () => {
    render(<CompileSummaryBar compiledFrom={makeCompiledFrom()} promptLength={12500} />)

    // toLocaleString() will format as "12,500" in en-US
    expect(screen.getByText('12,500')).toBeInTheDocument()
    expect(screen.getByText('chars')).toBeInTheDocument()
  })

  it('renders relative date when compiledAt is provided', () => {
    // Set "now" to a known time so relative dates are deterministic
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-19T17:00:00Z'))

    render(
      <CompileSummaryBar
        compiledFrom={makeCompiledFrom()}
        promptLength={1000}
        compiledAt="2026-03-19T16:30:00Z"
      />,
    )

    expect(screen.getByText('30m ago')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('shows "just now" for very recent compilations', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-19T17:00:00Z'))

    render(
      <CompileSummaryBar
        compiledFrom={makeCompiledFrom()}
        promptLength={1000}
        compiledAt="2026-03-19T17:00:00Z"
      />,
    )

    expect(screen.getByText('just now')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('shows hours for older compilations', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-19T20:00:00Z'))

    render(
      <CompileSummaryBar
        compiledFrom={makeCompiledFrom()}
        promptLength={1000}
        compiledAt="2026-03-19T15:00:00Z"
      />,
    )

    expect(screen.getByText('5h ago')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('omits date section when compiledAt is not provided', () => {
    render(<CompileSummaryBar compiledFrom={makeCompiledFrom()} promptLength={1000} />)

    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
  })
})
