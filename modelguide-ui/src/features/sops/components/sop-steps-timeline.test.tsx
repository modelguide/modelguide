import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeSopStep, makeStepWarning } from '../../../../test/sop-fixtures'
import { SopStepsTimeline } from './sop-steps-timeline'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
  }: { children: React.ReactNode; className?: string; to?: string; params?: unknown }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

describe('SopStepsTimeline', () => {
  it('renders steps with correct order numbers', () => {
    const steps = [
      makeSopStep({ id: 's1', order: 1, instruction: 'First step' }),
      makeSopStep({ id: 's2', order: 2, instruction: 'Second step' }),
    ]

    render(<SopStepsTimeline steps={steps} />)

    expect(screen.getByText('First step')).toBeInTheDocument()
    expect(screen.getByText('Second step')).toBeInTheDocument()
  })

  it('sorts steps by order regardless of input order', () => {
    const steps = [
      makeSopStep({ id: 's3', order: 3, instruction: 'Third' }),
      makeSopStep({ id: 's1', order: 1, instruction: 'First' }),
      makeSopStep({ id: 's2', order: 2, instruction: 'Second' }),
    ]

    const { container } = render(<SopStepsTimeline steps={steps} />)

    const instructions = container.querySelectorAll('.text-fg-primary')
    expect(instructions[0]).toHaveTextContent('First')
    expect(instructions[1]).toHaveTextContent('Second')
    expect(instructions[2]).toHaveTextContent('Third')
  })

  it('shows Required badge for required steps', () => {
    const steps = [makeSopStep({ id: 's1', order: 1, required: true, instruction: 'Do this' })]

    render(<SopStepsTimeline steps={steps} />)

    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('shows Optional badge for optional steps', () => {
    const steps = [
      makeSopStep({ id: 's1', order: 1, required: false, instruction: 'Maybe do this' }),
    ]

    render(<SopStepsTimeline steps={steps} />)

    expect(screen.getByText('Optional')).toBeInTheDocument()
  })

  it('shows tool reference pill when tool has resolvedName', () => {
    const steps = [
      makeSopStep({
        id: 's1',
        order: 1,
        tool: { resolvedName: 'glowbox_get_order' },
      }),
    ]

    render(<SopStepsTimeline steps={steps} />)

    expect(screen.getByText('get_order')).toBeInTheDocument()
    expect(screen.getByText('glowbox_')).toBeInTheDocument()
  })

  it('does not show tool pill when no tool', () => {
    const steps = [makeSopStep({ id: 's1', order: 1 })]

    render(<SopStepsTimeline steps={steps} />)

    expect(screen.queryByText('get_order')).not.toBeInTheDocument()
  })

  it('shows notes in italic when present', () => {
    const steps = [makeSopStep({ id: 's1', order: 1, notes: 'Be polite and professional' })]

    render(<SopStepsTimeline steps={steps} />)

    expect(screen.getByText('Be polite and professional')).toBeInTheDocument()
  })

  it('shows step warnings inline', () => {
    const steps = [makeSopStep({ id: 's1', order: 1 })]
    const warnings = [makeStepWarning({ stepId: 's1', message: 'Tool not found' })]

    render(<SopStepsTimeline steps={steps} warnings={warnings} />)

    expect(screen.getByText('Tool not found')).toBeInTheDocument()
  })

  it('does not show warnings for non-matching step IDs', () => {
    const steps = [makeSopStep({ id: 's1', order: 1 })]
    const warnings = [makeStepWarning({ stepId: 's99', message: 'Wrong step' })]

    render(<SopStepsTimeline steps={steps} warnings={warnings} />)

    expect(screen.queryByText('Wrong step')).not.toBeInTheDocument()
  })

  it('renders empty when no steps', () => {
    const { container } = render(<SopStepsTimeline steps={[]} />)

    expect(container.querySelector('.relative')).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="flex gap-4"]')).toHaveLength(0)
  })
})
