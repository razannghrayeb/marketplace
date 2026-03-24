'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { User } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { mapApiUser } from '@/lib/auth/mapUser'
import { useAuthStore } from '@/store/auth'

export default function AccountPage() {
  const qc = useQueryClient()
  const { user: storeUser, setUser, isAuthenticated } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const profile = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.auth.me)) as {
        success?: boolean
        user?: { id: number; email: string; user_type?: 'customer' | 'business'; is_admin?: boolean; created_at?: string }
        error?: { message?: string }
      }
      if (res.success === false || !res.user) throw new Error(res.error?.message ?? 'Could not load profile')
      return res.user
    },
    enabled: isAuthenticated(),
  })

  useEffect(() => {
    if (profile.data) {
      setEmail(profile.data.email)
    }
  }, [profile.data])

  useEffect(() => {
    if (storeUser?.email) setEmail((e) => e || storeUser.email)
  }, [storeUser?.email])

  const save = useMutation({
    mutationFn: async () => {
      const body: { email?: string; password?: string } = {}
      if (email.trim() && email.trim() !== profile.data?.email) body.email = email.trim()
      if (password.length >= 8) body.password = password
      if (!body.email && !body.password) throw new Error('Change email or enter a new password (min 8 chars)')
      const res = await api.patch(endpoints.auth.mePatch, body)
      const raw = res as { success?: boolean; user?: Parameters<typeof mapApiUser>[0]; error?: { message?: string } }
      if (raw.success === false) throw new Error(raw.error?.message ?? 'Update failed')
      return raw
    },
    onSuccess: (raw) => {
      if (raw.user) {
        setUser(mapApiUser(raw.user))
        void qc.invalidateQueries({ queryKey: ['auth-me'] })
        setPassword('')
      }
    },
  })

  if (!isAuthenticated()) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <User className="w-14 h-14 text-neutral-300 mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold text-neutral-800">Account</h1>
        <p className="text-neutral-600 mt-2 mb-6">Sign in to manage your profile.</p>
        <Link href="/login" className="btn-primary">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-neutral-800 mb-2">Account</h1>
      <p className="text-sm text-neutral-600 mb-8">Update email or password (PATCH /api/auth/me).</p>

      {profile.isLoading ? (
        <p className="text-neutral-500">Loading profile…</p>
      ) : profile.isError ? (
        <p className="text-neutral-900">{(profile.error as Error).message}</p>
      ) : (
        <form
          className="space-y-4 bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
            <input type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">New password</label>
            <input
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
            />
            <p className="text-xs text-neutral-500 mt-1">Min 8 characters if changing.</p>
          </div>
          {profile.data && (
            <p className="text-xs text-neutral-500">
              User #{profile.data.id}
              {profile.data.user_type && ` · ${profile.data.user_type}`}
              {profile.data.is_admin && ' · admin'}
            </p>
          )}
          {save.isError && <p className="text-sm text-neutral-900">{(save.error as Error).message}</p>}
          {save.isSuccess && <p className="text-sm text-green-700">Saved.</p>}
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}
    </div>
  )
}
