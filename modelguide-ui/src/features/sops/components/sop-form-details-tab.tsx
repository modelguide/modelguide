import { AutoTextarea } from '~/components/ui/auto-textarea'
import { Card, CardContent } from '~/components/ui/card'
import type { UseSopFormReturn } from '../hooks/use-sop-form'
import { inlineInput } from './sop-form-classes'

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
                className={inlineInput()}
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
                className={inlineInput({
                  font: 'mono',
                  className: 'disabled:cursor-not-allowed disabled:opacity-50',
                })}
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
              <AutoTextarea
                value={form.description}
                onChange={(e) => form.setDescription(e.target.value)}
                placeholder="What does this SOP do?"
                rows={2}
                className={inlineInput({ width: 'none' })}
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
                  className={inlineInput({ font: 'mono' })}
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
