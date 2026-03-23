'use client'

import { AdminApiRunner } from '@/components/admin/AdminApiRunner'

export default function AdminConsolePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">API console</h1>
        <p className="text-sm text-neutral-600 mt-1 max-w-2xl">
          Call backend routes with your session token. Multipart requests append files and optional JSON extra fields.
          Rate limits apply (e.g. try-on).
        </p>
      </div>
      <AdminApiRunner />
    </div>
  )
}
