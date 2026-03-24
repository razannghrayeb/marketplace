'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

interface SearchBarProps {
  variant?: 'default' | 'hero'
  placeholder?: string
  initialQuery?: string
}

export function SearchBar({ variant = 'default', placeholder, initialQuery = '' }: SearchBarProps) {
  const [q, setQ] = useState(initialQuery)
  const router = useRouter()

  useEffect(() => {
    setQ(initialQuery)
  }, [initialQuery])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim()) {
      router.push(`/search?q=${encodeURIComponent(q.trim())}`)
    } else {
      router.push('/search')
    }
  }

  const isHero = variant === 'hero'

  return (
    <form onSubmit={handleSubmit} className={`w-full ${isHero ? 'max-w-2xl' : 'max-w-xl mx-auto'}`}>
      <div
        className={`relative flex items-center rounded-2xl border transition-all duration-300
          ${isHero
            ? 'border-violet-200/90 bg-white/95 backdrop-blur-sm h-[3.5rem] sm:h-[4rem] shadow-lg shadow-violet-500/10 focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-500/18 focus-within:shadow-xl focus-within:shadow-violet-500/15'
            : 'border-neutral-200 bg-white h-12 focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-500/10 shadow-sm'
          }`}
      >
        <Search className={`absolute left-4 w-5 h-5 ${isHero ? 'text-violet-400' : 'text-neutral-400'}`} />
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
          className={`absolute right-2 px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all duration-200
            ${isHero
              ? 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-md shadow-violet-500/25 hover:from-violet-500 hover:to-fuchsia-400'
              : 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white hover:from-violet-500 hover:to-fuchsia-400'
            }`}
        >
          Search
        </button>
      </div>
    </form>
  )
}
