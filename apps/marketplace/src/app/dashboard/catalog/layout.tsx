/** Catalog DB pages call Supabase at request time — do not prerender (timeouts / stale). */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function DashboardCatalogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
