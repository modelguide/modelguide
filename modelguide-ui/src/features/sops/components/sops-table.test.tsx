import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeAssignedAgent, makeSopSummary } from '../../../../test/sop-fixtures'
import { SopsTable } from './sops-table'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

describe('SopsTable', () => {
  it('renders table headers', () => {
    render(<SopsTable sops={[]} />)

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Steps')).toBeInTheDocument()
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
  })

  it('renders SOP rows with name and slug', () => {
    const sops = [makeSopSummary({ name: 'Order Lookup', slug: 'order-lookup' })]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('Order Lookup')).toBeInTheDocument()
    expect(screen.getByText('order-lookup')).toBeInTheDocument()
  })

  it('renders status badges', () => {
    const sops = [
      makeSopSummary({ id: 'a', status: 'active', name: 'Active SOP' }),
      makeSopSummary({ id: 'b', status: 'draft', name: 'Draft SOP' }),
      makeSopSummary({ id: 'c', status: 'archived', name: 'Archived SOP' }),
    ]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(screen.getByText('archived')).toBeInTheDocument()
  })

  it('renders step count', () => {
    const sops = [makeSopSummary({ stepCount: 5 })]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows template name with icon when template exists', () => {
    const sops = [makeSopSummary({ templateName: 'WISMO Template' })]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('WISMO Template')).toBeInTheDocument()
  })

  it('shows "Custom" when no template', () => {
    const sops = [makeSopSummary({ templateName: null })]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('shows agent avatar initials', () => {
    const sops = [
      makeSopSummary({
        assignedAgents: [
          makeAssignedAgent({ id: 'a1', name: 'Support Bot' }),
          makeAssignedAgent({ id: 'a2', name: 'Sales Agent' }),
        ],
      }),
    ]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('SB')).toBeInTheDocument()
    expect(screen.getByText('SA')).toBeInTheDocument()
  })

  it('shows overflow count when more than 3 agents', () => {
    const sops = [
      makeSopSummary({
        assignedAgents: [
          makeAssignedAgent({ id: 'a1', name: 'Agent One' }),
          makeAssignedAgent({ id: 'a2', name: 'Agent Two' }),
          makeAssignedAgent({ id: 'a3', name: 'Agent Three' }),
          makeAssignedAgent({ id: 'a4', name: 'Agent Four' }),
        ],
      }),
    ]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('shows "None" when no agents assigned', () => {
    const sops = [makeSopSummary({ assignedAgents: [] })]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders multiple rows', () => {
    const sops = [
      makeSopSummary({ id: 'a', name: 'SOP Alpha' }),
      makeSopSummary({ id: 'b', name: 'SOP Beta' }),
      makeSopSummary({ id: 'c', name: 'SOP Gamma' }),
    ]

    render(<SopsTable sops={sops} />)

    expect(screen.getByText('SOP Alpha')).toBeInTheDocument()
    expect(screen.getByText('SOP Beta')).toBeInTheDocument()
    expect(screen.getByText('SOP Gamma')).toBeInTheDocument()
  })
})
