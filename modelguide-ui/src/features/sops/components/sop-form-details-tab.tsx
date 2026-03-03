import { Card, CardContent } from '~/components/ui/card'
import type { UseSopFormReturn } from '../hooks/use-sop-form'

interface SopFormDetailsTabProps {
  form: UseSopFormReturn
}

export function SopFormDetailsTab({ form }: SopFormDetailsTabProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">
              Name <span className="text-error">*</span>
            </dt>
            <dd className="mt-1">
              <input
                value={form.name}
                onChange={(e) => form.handleNameChange(e.target.value)}
                placeholder="e.g., Order Lookup"
                className="w-full bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Slug</dt>
            <dd className="mt-1">
              <input
                value={form.slug}
                onChange={(e) => form.handleSlugChange(e.target.value)}
                placeholder="e.g., order-lookup"
                disabled={form.isEditMode}
                className="w-full bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {form.isEditMode ? (
                <p className="mt-0.5 text-[10px] text-fg-muted">
                  Cannot change slug after creation
                </p>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Description</dt>
            <dd className="mt-1">
              <textarea
                value={form.description}
                onChange={(e) => {
                  form.setDescription(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                  }
                }}
                placeholder="What does this SOP do?"
                rows={2}
                className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
              />
            </dd>
          </div>
          {form.isEditMode ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Version</dt>
              <dd className="mt-1">
                <input
                  value={form.version}
                  onChange={(e) => form.setVersion(e.target.value)}
                  placeholder="e.g., 2"
                  className="w-full bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                />
                <p className="mt-0.5 text-[10px] text-fg-muted">
                  Bump when making significant changes
                </p>
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}
