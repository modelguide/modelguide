import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeSopTrigger } from '../../../../test/sop-fixtures'
import { SopTriggerBadge, SopTriggerDetail } from './sop-trigger-badge'

describe('SopTriggerBadge', () => {
  it('renders manual trigger', () => {
    render(<SopTriggerBadge trigger={makeSopTrigger('manual')} />)
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('renders channel trigger with comma-separated types', () => {
    render(<SopTriggerBadge trigger={makeSopTrigger('channel')} />)
    expect(screen.getByText('voice, chat')).toBeInTheDocument()
  })

  it('renders intent trigger with pattern count (plural)', () => {
    render(<SopTriggerBadge trigger={makeSopTrigger('intent_detected')} />)
    expect(screen.getByText('2 patterns')).toBeInTheDocument()
  })

  it('renders intent trigger with singular pattern count', () => {
    render(
      <SopTriggerBadge trigger={{ type: 'intent_detected', config: { patterns: ['hello'] } }} />,
    )
    expect(screen.getByText('1 pattern')).toBeInTheDocument()
  })

  it('renders tool present trigger with tool count', () => {
    render(<SopTriggerBadge trigger={makeSopTrigger('tool_present')} />)
    expect(screen.getByText('2 tools')).toBeInTheDocument()
  })

  it('renders tool present trigger with singular tool count', () => {
    render(
      <SopTriggerBadge trigger={{ type: 'tool_present', config: { toolSlugs: ['get_order'] } }} />,
    )
    expect(screen.getByText('1 tool')).toBeInTheDocument()
  })
})

describe('SopTriggerDetail', () => {
  it('renders channel types as individual badges', () => {
    render(<SopTriggerDetail trigger={makeSopTrigger('channel')} />)
    expect(screen.getByText('voice')).toBeInTheDocument()
    expect(screen.getByText('chat')).toBeInTheDocument()
  })

  it('renders intent patterns as badges', () => {
    render(<SopTriggerDetail trigger={makeSopTrigger('intent_detected')} />)
    expect(screen.getByText('where is my order')).toBeInTheDocument()
    expect(screen.getByText('track my package')).toBeInTheDocument()
  })

  it('renders tool slugs as monospace pills', () => {
    render(<SopTriggerDetail trigger={makeSopTrigger('tool_present')} />)
    expect(screen.getByText('get_order')).toBeInTheDocument()
    expect(screen.getByText('track_shipment')).toBeInTheDocument()
  })

  it('renders manual activation message', () => {
    render(<SopTriggerDetail trigger={makeSopTrigger('manual')} />)
    expect(screen.getByText('Manual activation')).toBeInTheDocument()
  })
})
