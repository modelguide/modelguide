import { Card, CardContent } from '~/components/ui/card'
import type { UseSopFormReturn } from '../hooks/use-sop-form'

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
                className="w-full bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
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
                className="w-full bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
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
                className="w-full bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
              />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
