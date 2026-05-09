import { AdminBasePathProvider } from '@/components/admin/AdminBasePathContext'
import { AdminDashboardShell } from '@/components/admin/AdminDashboardShell'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminBasePathProvider value="/dashboard">
      <AdminDashboardShell brandLabel="Business">{children}</AdminDashboardShell>
    </AdminBasePathProvider>
  )
}
