import clsx from 'clsx'
import type { IssueSeverity } from '@/types'

// ─── Badge ─────────────────────────────────────────────────────────────────────
const SEVERITY_CLASS: Record<IssueSeverity, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning:  'bg-amber-50 text-amber-700 border-amber-200',
  stale:    'bg-orange-50 text-orange-700 border-orange-200',
  info:     'bg-blue-50 text-blue-700 border-blue-200',
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
    : color === 'green'  ? 'bg-green-50 text-green-700 border-green-200'
    : color === 'purple' ? 'bg-purple-50 text-purple-700 border-purple-200'
    : color === 'teal'   ? 'bg-teal-50 text-teal-700 border-teal-200'
    : 'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border',
      colorClass, className
    )}>
      {children}
    </span>
  )
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'good' | 'warn' | 'danger' | 'purple'
}

export function KpiCard({ label, value, sub, tone = 'default' }: KpiCardProps) {
  const valColor =
    tone === 'good'   ? 'text-teal-600'
    : tone === 'warn'   ? 'text-amber-600'
    : tone === 'danger' ? 'text-red-600'
    : tone === 'purple' ? 'text-purple-600'
    : 'text-gray-900'

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">{label}</p>
      <p className={clsx('text-2xl font-semibold leading-none', valColor)}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[11px] text-gray-400 mt-1.5">{sub}</p>}
    </div>
  )
}

// ─── Page Header ───────────────────────────────────────────────────────────────
interface PageHeaderProps {
  title: string
  sub?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, sub, actions }: PageHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between">
      <div>
        <h1 className="text-[15px] font-semibold text-gray-900">{title}</h1>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

// ─── Section ───────────────────────────────────────────────────────────────────
interface SectionProps {
  title?: string
  actions?: React.ReactNode
  children: React.ReactNode
  noPad?: boolean
}

export function Section({ title, actions, children, noPad }: SectionProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {(title || actions) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          {title && <p className="text-sm font-medium text-gray-800">{title}</p>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4'}>{children}</div>
    </div>
  )
}

// ─── Availability Dot ──────────────────────────────────────────────────────────
export function AvailBadge({ avail }: { avail: boolean | null }) {
  if (avail === null) return <span className="text-gray-400 text-xs">—</span>
  return avail
    ? <span className="text-green-600 font-medium text-xs">In stock</span>
    : <span className="text-red-500 text-xs">Out</span>
}

// ─── Health Bar ────────────────────────────────────────────────────────────────
export function HealthBar({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-teal-500'
    : score >= 60 ? 'bg-amber-400'
    : 'bg-red-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[11px] text-gray-400 w-8 text-right">{score}%</span>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('bg-gray-100 rounded animate-pulse', className)} />
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ message = 'No data found' }: { message?: string }) {
  return (
    <div className="text-center py-12 text-gray-400 text-sm">{message}</div>
  )
}

// ─── Filter Button ─────────────────────────────────────────────────────────────
interface FilterBtnProps {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}

export function FilterBtn({ active, onClick, children }: FilterBtnProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-xs px-3 py-1.5 rounded-lg border transition-colors',
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
      )}
    >
      {children}
    </button>
  )
}

// ─── Text Input ────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
}

export function Input({ icon, className, ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
          {icon}
        </span>
      )}
      <input
        className={clsx(
          'h-8 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400',
          'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400',
          icon ? 'pl-8 pr-3' : 'px-3',
          className
        )}
        {...props}
      />
    </div>
  )
}

// ─── Select ────────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

export function Select({ options, placeholder, className, ...props }: SelectProps) {
  return (
    <select
      className={clsx(
        'h-8 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 px-2.5 pr-7',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400',
        'appearance-none cursor-pointer',
        className
      )}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ─── Product Thumbnail ─────────────────────────────────────────────────────────
export function ProductThumb({ src, alt }: { src?: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200">
        <span className="text-gray-300 text-[10px]">img</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="w-9 h-9 rounded-lg object-cover border border-gray-200"
      onError={(e) => {
        const target = e.currentTarget
        target.style.display = 'none'
      }}
    />
  )
}
