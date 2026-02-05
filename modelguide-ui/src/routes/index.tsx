import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base">
      <div className="text-center animate-fade-up">
        {/* Logo */}
        <h1 className="font-mono text-2xl tracking-tight">
          <span className="text-fg-muted">{'{'}</span>
          <span className="text-fg-primary font-medium">model</span>
          <span className="text-fg-muted">:</span>
          <span className="text-brand-500 font-medium">guide</span>
          <span className="text-fg-muted">{'}'}</span>
        </h1>

        {/* Status */}
        <div className="mt-8 space-y-2">
          <p className="text-fg-secondary text-sm">Phase 0 complete — scaffolding ready</p>
          <p className="text-fg-muted text-xs font-sans">
            See docs/UI_IMPLEMENTATION.md for next steps
          </p>
        </div>

        {/* Visual accent */}
        <div className="mt-12 flex justify-center gap-1">
          <div className="h-1 w-1 rounded-full bg-brand-500 animate-pulse-glow" />
          <div className="h-1 w-8 rounded-full bg-fg-subtle" />
          <div className="h-1 w-1 rounded-full bg-fg-subtle" />
        </div>
      </div>
    </div>
  )
}
