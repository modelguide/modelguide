import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PromptDiffViewer } from './prompt-diff-viewer'

describe('PromptDiffViewer', () => {
  it('shows added and removed line counts in the stats header', () => {
    render(<PromptDiffViewer oldContent="line one\nline two" newContent="line one\nline changed" />)

    // Should show stats header with counts
    expect(screen.getByText('lines changed')).toBeInTheDocument()
  })

  it('renders added lines with + prefix', () => {
    render(
      <PromptDiffViewer
        oldContent={'line one\nline two\n'}
        newContent={'line one\nline two\nline three\n'}
      />,
    )

    // The + in the gutter (not the stats header)
    const plusMarkers = screen.getAllByText('+')
    expect(plusMarkers.length).toBeGreaterThan(0)
    expect(screen.getByText('line three')).toBeInTheDocument()
  })

  it('renders removed lines with - prefix', () => {
    render(<PromptDiffViewer oldContent={'line one\nline two\n'} newContent={'line one\n'} />)

    // The - in the gutter marks removed lines
    const minusMarkers = screen.getAllByText('-')
    expect(minusMarkers.length).toBeGreaterThan(0)
  })

  it('shows zero changes when content is identical', () => {
    render(<PromptDiffViewer oldContent="same content" newContent="same content" />)

    expect(screen.getByText('+0')).toBeInTheDocument()
    expect(screen.getByText('-0')).toBeInTheDocument()
  })

  it('renders line numbers only for non-removed lines', () => {
    render(<PromptDiffViewer oldContent="old line" newContent="new line" />)

    // The new line should get line number 1
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('handles empty old content (full addition)', () => {
    render(<PromptDiffViewer oldContent="" newContent="brand new content" />)

    expect(screen.getByText('brand new content')).toBeInTheDocument()
    const plusMarkers = screen.getAllByText('+')
    expect(plusMarkers.length).toBeGreaterThan(0)
  })

  it('handles multiline diffs correctly', () => {
    const old = 'line 1\nline 2\nline 3'
    const updated = 'line 1\nline 2 modified\nline 3\nline 4 added'

    render(<PromptDiffViewer oldContent={old} newContent={updated} />)

    expect(screen.getByText('line 2 modified')).toBeInTheDocument()
    expect(screen.getByText('line 4 added')).toBeInTheDocument()
  })
})
