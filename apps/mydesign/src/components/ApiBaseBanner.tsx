'use client'

import { getApiBase } from '@/lib/api/client'

export function ApiBaseBanner() {
  return (
    <p className="text-xs text-neutral-500">
      API base:{' '}
      <code className="text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">{getApiBase()}</code>
    </p>
  )
}
