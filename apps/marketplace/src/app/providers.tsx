'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { TryOnProvider } from '@/context/try-on-context'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60 * 1000, retry: 1 },
        },
      })
  )
  return (
    <QueryClientProvider client={client}>
      <TryOnProvider>{children}</TryOnProvider>
    </QueryClientProvider>
  )
}
