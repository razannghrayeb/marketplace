import clsx from 'clsx'
import type { IssueSeverity } from '@/types/catalog-admin'

const SEVERITY_CLASS: Record<IssueSeverity, string> = {
  critical: 'bg-red-50 text-red-800 border-red-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  stale: 'bg-orange-50 text-orange-800 border-orange-200',
  info: 'bg-violet-50 text-violet-800 border-violet-200',
}

interface BadgeProps {
  severity?: IssueSeverity
  color?: 'green' | 'gray' | 'purple' | 'teal'
  children: React.ReactNode
  className?: string
}

export function Badge({ severity, color, children, className }: BadgeProps) {
  const colorClass = severity
    ? SEVERITY_CLASS[severity]
    : color === 'green'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : color === 'purple'
        ? 'bg-violet-50 text-violet-800 border-violet-200'
        : color === 'teal'
          ? 'bg-teal-50 text-teal-800 border-teal-200'
          : 'bg-neutral-100 text-neutral-700 border-neutral-200'

  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border',
        colorClass,
        className
      )}
    >
      {children}
    </span>
  )
}

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'good' | 'warn' | 'danger' | 'purple'
}

export function KpiCard({ label, value, sub, tone = 'default' }: KpiCardProps) {
  const valColor =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'danger'
          ? 'text-red-600'
          : tone === 'purple'
            ? 'text-violet-600'
            : 'text-neutral-900'

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white/95 backdrop-blur-sm p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_24px_-4px_rgba(109,40,217,0.07)] hover:border-violet-200/70 transition-colors">
      <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5 font-display">
        {label}
      </p>
      <p className={clsx('text-2xl font-semibold leading-none font-display', valColor)}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[11px] text-neutral-500 mt-1.5">{sub}</p>}
    </div>
  )
}

interface PageHeaderProps {
  title: string
  sub?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, sub, actions }: PageHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-violet-200/40 px-6 py-3.5 flex items-center justify-between">
      <div>
        <h1 className="text-[15px] font-semibold text-neutral-900 font-display">{title}</h1>
        {sub && <p className="text-xs text-neutral-500 mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

interface SectionProps {
  title?: string
  actions?: React.ReactNode
  children: React.ReactNode
  noPad?: boolean
}

export function Section({ title, actions, children, noPad }: SectionProps) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white/95 backdrop-blur-sm overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_24px_-4px_rgba(109,40,217,0.05)]">
      {(title || actions) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
          {title && (
            <p className="text-sm font-medium text-neutral-800 font-display">{title}</p>
          )}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4'}>{children}</div>
    </div>
  )
}

export function AvailBadge({ avail }: { avail: boolean | null }) {
  if (avail === null) return <span className="text-neutral-400 text-xs">—</span>
  return avail ? (
    <span className="text-emerald-600 font-medium text-xs">In stock</span>
  ) : (
    <span className="text-red-500 text-xs">Out</span>
  )
}

export function HealthBar({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : score >= 60 ? 'bg-amber-400' : 'bg-red-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[11px] text-neutral-500 w-8 text-right">{score}%</span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('bg-violet-100/60 rounded animate-pulse', className)} />
}

export function EmptyState({ message = 'No data found' }: { message?: string }) {
  return <div className="text-center py-12 text-neutral-500 text-sm">{message}</div>
}

interface FilterBtnProps {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}

export function FilterBtn({ active, onClick, children }: FilterBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'text-xs px-3 py-1.5 rounded-full border transition-colors font-medium',
        active
          ? 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white border-transparent shadow-md shadow-violet-500/25'
          : 'bg-white text-neutral-600 border-neutral-200 hover:border-violet-300 hover:text-violet-900'
      )}
    >
      {children}
    </button>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
}

export function Input({ icon, className, ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400">{icon}</span>
      )}
      <input
        className={clsx(
          'h-8 border border-neutral-200 rounded-lg text-sm bg-white text-neutral-900 placeholder-neutral-400',
          'focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400',
          icon ? 'pl-8 pr-3' : 'px-3',
          className
        )}
        {...props}
      />
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

export function Select({ options, placeholder, className, ...props }: SelectProps) {
  return (
    <select
      className={clsx(
        'h-8 border border-neutral-200 rounded-lg text-sm bg-white text-neutral-900 px-2.5 pr-7',
        'focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400',
        'appearance-none cursor-pointer',
        className
      )}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function ProductThumb({ src, alt }: { src?: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center border border-violet-100">
        <span className="text-violet-300 text-[10px]">img</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="w-9 h-9 rounded-lg object-cover border border-neutral-200"
      onError={(e) => {
        const target = e.currentTarget
        target.style.display = 'none'
      }}
    />
  )
}
