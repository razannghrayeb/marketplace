import { Loader2 } from 'lucide-react'

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 opacity-25 blur-xl" />
        <Loader2 className="relative h-12 w-12 animate-spin text-violet-600" aria-hidden />
      </div>
      <p className="text-sm font-medium text-neutral-600">{label}</p>
      <div className="flex w-full max-w-md flex-col gap-2">
        <div className="h-3 w-full rounded-full bg-neutral-200/80 skeleton-shimmer" />
        <div className="h-3 w-[80%] rounded-full bg-neutral-200/80 skeleton-shimmer" />
        <div className="h-3 w-[55%] rounded-full bg-neutral-200/80 skeleton-shimmer" />
      </div>
    </div>
  )
}
