import { AdminBasePathProvider } from '@/components/admin/AdminBasePathContext'
import { AdminDashboardShell } from '@/components/admin/AdminDashboardShell'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminBasePathProvider value="/admin">
      <AdminDashboardShell brandLabel="Admin">{children}</AdminDashboardShell>
    </AdminBasePathProvider>
  )
}
