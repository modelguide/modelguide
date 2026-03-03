import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeSopMetadata } from '../../../../test/sop-fixtures'
import { SopMetadataCard } from './sop-metadata-card'

describe('SopMetadataCard', () => {
  it('renders all metadata fields when present', () => {
    render(<SopMetadataCard metadata={makeSopMetadata()} />)

    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('order')).toBeInTheDocument()
    expect(screen.getByText('tracking')).toBeInTheDocument()
    expect(screen.getByText('WISMO-001')).toBeInTheDocument()
    expect(screen.getByText('2-5 minutes')).toBeInTheDocument()
  })

  it('renders tags as badges', () => {
    render(<SopMetadataCard metadata={makeSopMetadata({ tags: ['billing', 'refund'] })} />)

    expect(screen.getByText('billing')).toBeInTheDocument()
    expect(screen.getByText('refund')).toBeInTheDocument()
  })

  it('renders reason code', () => {
    render(
      <SopMetadataCard metadata={makeSopMetadata({ tags: undefined, reasonCode: 'REFUND-003' })} />,
    )

    expect(screen.getByText('REFUND-003')).toBeInTheDocument()
  })

  it('renders estimated duration', () => {
    render(
      <SopMetadataCard
        metadata={makeSopMetadata({
          tags: undefined,
          reasonCode: undefined,
          estimatedDuration: '10-15 minutes',
        })}
      />,
    )

    expect(screen.getByText('10-15 minutes')).toBeInTheDocument()
  })

  it('renders escalation triggers', () => {
    render(
      <SopMetadataCard
        metadata={{
          escalationTriggers: ['Customer requests supervisor', 'Order value over $500'],
        }}
      />,
    )

    expect(screen.getByText('Customer requests supervisor')).toBeInTheDocument()
    expect(screen.getByText('Order value over $500')).toBeInTheDocument()
  })

  it('shows empty state when no metadata fields are set', () => {
    render(<SopMetadataCard metadata={{}} />)

    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('No metadata defined')).toBeInTheDocument()
  })

  it('always renders the card (never returns null)', () => {
    const { container } = render(<SopMetadataCard metadata={{}} />)

    // Card should exist in the DOM
    expect(container.firstChild).not.toBeNull()
  })
})
