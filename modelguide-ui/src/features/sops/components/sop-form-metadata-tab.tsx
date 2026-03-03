import { Card, CardContent } from '~/components/ui/card'
import type { UseSopFormReturn } from '../hooks/use-sop-form'
import { inlineInput } from './sop-form-classes'

interface SopFormMetadataTabProps {
  form: UseSopFormReturn
}

export function SopFormMetadataTab({ form }: SopFormMetadataTabProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Tags</dt>
            <dd className="mt-1">
              <input
                value={form.tags}
                onChange={(e) => form.setTags(e.target.value)}
                placeholder="e.g., order, tracking, status"
                className={inlineInput()}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Reason Code</dt>
            <dd className="mt-1">
              <input
                value={form.reasonCode}
                onChange={(e) => form.setReasonCode(e.target.value)}
                placeholder="e.g., WISMO-001"
                className={inlineInput({ font: 'mono' })}
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Duration</dt>
            <dd className="mt-1">
              <input
                value={form.estimatedDuration}
                onChange={(e) => form.setEstimatedDuration(e.target.value)}
                placeholder="e.g., 2-5 minutes"
                className={inlineInput()}
              />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
