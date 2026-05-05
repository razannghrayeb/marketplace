'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'

interface SearchBarProps {
  variant?: 'default' | 'hero' | 'textSearch' | 'discoverHero'
  placeholder?: string
  initialQuery?: string
  isLoading?: boolean
  /** Cycles in the hero placeholder when `variant === 'discoverHero'` and the input is empty. */
  rotatingPlaceholders?: readonly string[]
}

export function SearchBar({
  variant = 'default',
  placeholder,
  initialQuery = '',
  isLoading = false,
  rotatingPlaceholders,
}: SearchBarProps) {
  const [q, setQ] = useState(initialQuery)
  const [rotateIdx, setRotateIdx] = useState(0)
  const router = useRouter()
  const textSearchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQ(initialQuery)
  }, [initialQuery])

  const isDiscoverHero = variant === 'discoverHero'
  const tips = rotatingPlaceholders?.length ? rotatingPlaceholders : null

  useEffect(() => {
    if (!isDiscoverHero || !tips || q.trim()) return
    const id = window.setInterval(() => {
      setRotateIdx((i) => (i + 1) % tips.length)
    }, 4000)
    return () => window.clearInterval(id)
  }, [isDiscoverHero, tips, q])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim()) {
      router.push(`/search?q=${encodeURIComponent(q.trim())}`)
    } else {
      textSearchInputRef.current?.focus()
      router.push('/search')
    }
  }

  const isHero = variant === 'hero'
  const isTextSearch = variant === 'textSearch'

  const discoverPlaceholder =
    isDiscoverHero && tips && !q.trim()
      ? `Try "${tips[rotateIdx] ?? tips[0]}"`
      : placeholder || 'Describe what you want in plain language…'

  if (isDiscoverHero) {
    return (
      <form id="discover-hero-search" onSubmit={handleSubmit} className="w-full max-w-2xl lg:max-w-none">
        <div className="relative flex h-[2.875rem] items-center rounded-full border border-white/55 bg-white/35 px-1 shadow-[0_8px_28px_-12px_rgba(43,37,33,0.16)] backdrop-blur-xl transition-all duration-300 focus-within:border-white/75 focus-within:bg-white/45 focus-within:shadow-[0_12px_36px_-12px_rgba(43,37,33,0.18)] sm:h-[3.125rem]">
          <Search className="pointer-events-none absolute left-4 w-[1.05rem] text-[#6d5d52] sm:left-5 sm:w-5" aria-hidden />
          <input
            ref={textSearchInputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={discoverPlaceholder}
            className="h-full w-full rounded-full border-0 bg-transparent pl-11 pr-[5.75rem] text-[14px] text-[#2b2521] placeholder:text-[#7a6b62] focus:outline-none focus:ring-0 sm:pl-12 sm:pr-[6.5rem] sm:text-[14px]"
          />
          <div className="absolute right-2 flex items-center gap-1 sm:right-3">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#7a6b62]" aria-label="Searching" />
            ) : null}
            {q.length > 0 && !isLoading ? (
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  router.push('/search')
                }}
                className="rounded-full p-2 text-[#7a6b62] transition-colors hover:bg-white/50 hover:text-[#2b2521]"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={isLoading}
              className="shrink-0 rounded-full bg-[#5c493a] px-3 py-1.5 text-xs font-semibold text-[#f8f3ee] shadow-md transition hover:bg-[#4d3f35] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60 sm:px-4 sm:py-2 sm:text-sm"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Searching</span>
                </span>
              ) : (
                'Search'
              )}
            </button>
          </div>
        </div>
      </form>
    )
  }

  if (isTextSearch) {
    return (
      <form onSubmit={handleSubmit} className="w-full max-w-4xl mx-auto">
        <div
          className="relative flex items-center h-[3.25rem] sm:h-[3.75rem] rounded-full border border-[#e8e4df] bg-white shadow-[0_8px_40px_-12px_rgba(42,38,35,0.08)] transition-all duration-300 focus-within:border-[#d4cdc4] focus-within:shadow-[0_12px_48px_-14px_rgba(42,38,35,0.12)]"
        >
          <Search className="absolute left-5 sm:left-6 w-5 h-5 text-[#9c9590]" aria-hidden />
          <input
            ref={textSearchInputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder || 'Describe what you want in plain language…'}
            className="w-full h-full pl-14 sm:pl-[3.25rem] pr-[7.25rem] sm:pr-[8rem] bg-transparent rounded-full focus:outline-none text-[15px] sm:text-[16px] text-[#2a2623] placeholder:text-[#a39e98]"
          />
          <div className="absolute right-2 sm:right-3 flex items-center gap-1">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#9c9590]" aria-label="Searching" />
            ) : null}
            {q.length > 0 && !isLoading ? (
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  router.push('/search')
                }}
                className="p-2 rounded-full text-[#9c9590] hover:bg-[#f3f1ee] hover:text-[#2a2623] transition-colors"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={isLoading}
              className="shrink-0 rounded-full bg-brand px-4 py-2 sm:px-5 sm:py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/20 transition-all hover:bg-brand-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Searching</span>
                </span>
              ) : (
                'Search'
              )}
            </button>
          </div>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className={`w-full ${isHero ? 'max-w-2xl' : 'max-w-xl mx-auto'}`}>
      <div
        className={`relative flex items-center rounded-2xl border transition-all duration-300
          ${isHero
            ? 'border-[#d8cbc4] bg-white/95 backdrop-blur-sm h-[3.5rem] sm:h-[4rem] shadow-lg shadow-brand/10 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15 focus-within:shadow-xl focus-within:shadow-brand/15'
            : 'border-neutral-200 bg-white h-12 focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/10 shadow-sm'
          }`}
      >
        <Search className={`absolute left-4 w-5 h-5 ${isHero ? 'text-orange-500' : 'text-neutral-400'}`} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder || 'Search "red summer dress", "casual sneakers"...'}
          className={`w-full pl-12 pr-[5.5rem] bg-transparent focus:outline-none
            ${isHero
              ? 'text-neutral-900 placeholder-neutral-400 text-base sm:text-lg'
              : 'text-neutral-800 placeholder-neutral-400 text-base'
            }`}
        />
        <button
          type="submit"
          disabled={isLoading}
          className={`absolute right-2 px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all duration-200
            bg-brand text-white shadow-md shadow-brand/25 hover:bg-brand-hover disabled:opacity-70 disabled:pointer-events-none`}
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </span>
          ) : (
            'Search'
          )}
        </button>
      </div>
    </form>
  )
}
