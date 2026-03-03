import { Plus, Trash2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import type { SopTrigger } from '~/schemas/sops'
import type { UseSopFormReturn } from '../hooks/use-sop-form'

interface SopFormTriggerTabProps {
  form: UseSopFormReturn
}

export function SopFormTriggerTab({ form }: SopFormTriggerTabProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Type</dt>
            <dd className="mt-1">
              <select
                aria-label="Trigger Type"
                value={form.triggerType}
                onChange={(e) => form.setTriggerType(e.target.value as SopTrigger['type'])}
                className="w-full appearance-none bg-transparent px-1.5 py-1 text-sm text-fg-primary rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30 cursor-pointer"
              >
                <option value="manual">Manual</option>
                <option value="channel">Channel</option>
                <option value="intent_detected">Intent Detected</option>
                <option value="tool_present">Tool Present</option>
              </select>
            </dd>
          </div>

          {form.triggerType === 'channel' ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">
                Channel Types <span className="text-error">*</span>
              </dt>
              <dd className="mt-1">
                <div className="flex flex-wrap gap-2 px-1.5 py-1">
                  {(['voice', 'chat', 'email'] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.channelTypes.includes(ch)}
                        onChange={(e) => form.toggleChannel(ch, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                      />
                      <span className="text-xs text-fg-primary capitalize">{ch}</span>
                    </label>
                  ))}
                </div>
              </dd>
            </div>
          ) : null}

          {form.triggerType === 'intent_detected' ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">
                Patterns <span className="text-error">*</span>
              </dt>
              <dd className="mt-1 space-y-1">
                {form.patterns.map((pattern) => (
                  <div key={pattern.id} className="flex items-center gap-1">
                    <input
                      value={pattern.value}
                      onChange={(e) => form.updatePattern(pattern.id, e.target.value)}
                      placeholder="e.g., where is my order"
                      className="flex-1 bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                    />
                    {form.patterns.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-5 w-5"
                        onClick={() => form.removePattern(pattern.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={form.addPattern}
                >
                  <Plus className="h-3 w-3" />
                  Add Pattern
                </Button>
              </dd>
            </div>
          ) : null}

          {form.triggerType === 'tool_present' ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">
                Tool Slugs <span className="text-error">*</span>
              </dt>
              <dd className="mt-1 space-y-1">
                {form.toolSlugs.map((ts) => (
                  <div key={ts.id} className="flex items-center gap-1">
                    <input
                      value={ts.value}
                      onChange={(e) => form.updateToolSlug(ts.id, e.target.value)}
                      placeholder="e.g., get_order"
                      className="flex-1 bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                    />
                    {form.toolSlugs.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-5 w-5"
                        onClick={() => form.removeToolSlug(ts.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={form.addToolSlug}
                >
                  <Plus className="h-3 w-3" />
                  Add Tool Slug
                </Button>
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}
