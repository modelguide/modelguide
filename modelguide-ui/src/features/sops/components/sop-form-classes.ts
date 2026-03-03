import { cva } from 'class-variance-authority'

/**
 * Inline input/select/textarea classes for the SOP form.
 * These style raw elements (not the `Input`/`Select` primitives)
 * to match the sidebar's inline-editable look.
 */
export const inlineInput = cva(
  'bg-transparent px-1.5 text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30',
  {
    variants: {
      width: {
        full: 'w-full',
        flex: 'flex-1',
        none: '',
      },
      size: {
        sm: 'py-1 text-sm',
        xs: 'py-0.5 text-xs',
      },
      font: {
        sans: '',
        mono: 'font-mono',
      },
    },
    defaultVariants: {
      width: 'full',
      size: 'sm',
      font: 'sans',
    },
  },
)

export const inlineSelect =
  'w-full appearance-none bg-transparent px-1.5 py-1 text-sm text-fg-primary rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30 cursor-pointer'

export const inlineCheckbox =
  'h-3.5 w-3.5 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500'
