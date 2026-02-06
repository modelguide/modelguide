import { type LabelHTMLAttributes, forwardRef } from 'react'
import { cn } from '~/lib/cn'

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed via ...props by consumers
    <label
      ref={ref}
      className={cn(
        'mb-2 block font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted',
        className,
      )}
      {...props}
    >
      {children}
      {required ? <span className="ml-0.5 text-error">*</span> : null}
    </label>
  ),
)
Label.displayName = 'Label'

export { Label }
