import { Eye } from 'lucide-react'

export function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-brand-500/10 border-b border-brand-500/20 px-4 py-2 text-sm text-brand-400">
      <Eye className="h-4 w-4" />
      <span>You are in demo mode — browsing is read-only</span>
    </div>
  )
}
