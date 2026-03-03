import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeSopTemplate } from '../../../../test/sop-fixtures'
import { TemplatesGrid } from './templates-grid'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

describe('TemplatesGrid', () => {
  it('renders template cards', () => {
    const templates = [
      makeSopTemplate({ id: 't1', name: 'WISMO Template' }),
      makeSopTemplate({ id: 't2', name: 'Refund Template' }),
    ]

    render(<TemplatesGrid templates={templates} />)

    expect(screen.getByText('WISMO Template')).toBeInTheDocument()
    expect(screen.getByText('Refund Template')).toBeInTheDocument()
  })

  it('shows empty state when no templates', () => {
    render(<TemplatesGrid templates={[]} />)

    expect(screen.getByText('No templates available')).toBeInTheDocument()
    expect(
      screen.getByText('SOP templates will appear here when they are added to the catalog'),
    ).toBeInTheDocument()
  })

  it('shows template description', () => {
    const templates = [
      makeSopTemplate({ id: 't1', description: 'Handle order tracking inquiries' }),
    ]

    render(<TemplatesGrid templates={templates} />)

    expect(screen.getByText('Handle order tracking inquiries')).toBeInTheDocument()
  })

  it('shows catalog slugs as badges', () => {
    const templates = [makeSopTemplate({ id: 't1', catalogSlugs: ['medusa', 'zendesk'] })]

    render(<TemplatesGrid templates={templates} />)

    expect(screen.getByText('medusa')).toBeInTheDocument()
    expect(screen.getByText('zendesk')).toBeInTheDocument()
  })

  it('shows step count', () => {
    const templates = [
      makeSopTemplate({
        id: 't1',
        definition: {
          schemaVersion: 1,
          trigger: { type: 'manual', config: {} },
          steps: [
            { id: 's1', order: 1, instruction: 'Step 1', required: true },
            { id: 's2', order: 2, instruction: 'Step 2', required: true },
            { id: 's3', order: 3, instruction: 'Step 3', required: false },
          ],
          metadata: {},
        },
      }),
    ]

    render(<TemplatesGrid templates={templates} />)

    expect(screen.getByText('3 steps')).toBeInTheDocument()
  })

  it('shows singular step count', () => {
    const templates = [
      makeSopTemplate({
        id: 't1',
        definition: {
          schemaVersion: 1,
          trigger: { type: 'manual', config: {} },
          steps: [{ id: 's1', order: 1, instruction: 'Only step', required: true }],
          metadata: {},
        },
      }),
    ]

    render(<TemplatesGrid templates={templates} />)

    expect(screen.getByText('1 step')).toBeInTheDocument()
  })

  it('shows version badge', () => {
    const templates = [makeSopTemplate({ id: 't1', version: '3' })]

    render(<TemplatesGrid templates={templates} />)

    expect(screen.getByText('v3')).toBeInTheDocument()
  })

  it('shows fork button when showForkButton is true', () => {
    const templates = [makeSopTemplate({ id: 't1' })]

    render(<TemplatesGrid templates={templates} showForkButton />)

    expect(screen.getByText('Use Template')).toBeInTheDocument()
  })

  it('hides fork button when showForkButton is false', () => {
    const templates = [makeSopTemplate({ id: 't1' })]

    render(<TemplatesGrid templates={templates} showForkButton={false} />)

    expect(screen.queryByText('Use Template')).not.toBeInTheDocument()
  })
})
