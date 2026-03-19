'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

interface SearchBarProps {
  variant?: 'default' | 'hero'
  placeholder?: string
}

export function SearchBar({ variant = 'default', placeholder }: SearchBarProps) {
  const [q, setQ] = useState('')
  const router = useRouter()

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
    <form onSubmit={handleSubmit} className="w-full max-w-xl mx-auto">
      <div
        className={`relative flex items-center rounded-2xl bg-white border border-cream-300 shadow-soft
          ${isHero ? 'h-14' : 'h-12'} focus-within:ring-2 focus-within:ring-wine-500/30 focus-within:border-wine-500 transition-all`}
      >
        <Search className="absolute left-4 w-5 h-5 text-charcoal-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder || 'Search "red summer dress", "casual sneakers"...'}
          className={`w-full pl-12 pr-4 bg-transparent text-charcoal-700 placeholder-charcoal-400 focus:outline-none
            ${isHero ? 'text-lg' : 'text-base'}`}
        />
        <button
          type="submit"
          className="absolute right-2 px-4 py-2 rounded-xl bg-wine-700 text-white font-medium hover:bg-wine-800 transition-colors"
        >
          Search
        </button>
      </div>
    </form>
  )
}
