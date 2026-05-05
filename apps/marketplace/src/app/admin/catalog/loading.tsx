'use client'

import { Loader2 } from 'lucide-react'

export default function AdminCatalogLoading() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center px-6">
      <div className="inline-flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-[#2a2623]" />
        <span className="text-sm font-medium text-neutral-700">Loading dashboard data...</span>
      </div>
    </div>
  )
}
