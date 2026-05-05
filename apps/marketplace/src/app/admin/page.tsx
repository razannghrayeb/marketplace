import { redirect } from 'next/navigation'

/** Admin UI is catalog-only; landing sends admins straight to the database overview. */
export default function AdminRootPage() {
  redirect('/admin/catalog')
}
