'use client'

import { createContext, useContext } from 'react'

const AdminBasePathContext = createContext('/admin')

export function AdminBasePathProvider({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  const normalized = value.replace(/\/$/, '') || '/admin'
  return <AdminBasePathContext.Provider value={normalized}>{children}</AdminBasePathContext.Provider>
}

export function useAdminBasePath(): string {
  return useContext(AdminBasePathContext)
}
