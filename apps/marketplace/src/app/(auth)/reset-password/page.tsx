'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenFromUrl = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!tokenFromUrl) {
      setError('This reset link is missing or invalid. Request a new link from the sign-in page.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ message?: string }>(endpoints.auth.resetPassword, {
        token: tokenFromUrl,
        password,
      })
      if (res.success) {
        const msg =
          (res as { message?: string }).message || 'Your password was updated. You can sign in.'
        setInfo(msg)
        setTimeout(() => router.push('/login'), 2000)
      } else {
        setError(res.error?.message || 'Could not reset password')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <div className="bg-white rounded-3xl shadow-elevated border border-neutral-200 p-8">
        <h1 className="font-display text-2xl font-bold text-neutral-800 text-center">New password</h1>
        <p className="text-neutral-500 text-center mt-2">Choose a strong password for your Bolden account.</p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="reset-password" className="block text-sm font-medium text-neutral-700 mb-1">
              New password
            </label>
            <input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="input-field"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label htmlFor="reset-confirm" className="block text-sm font-medium text-neutral-700 mb-1">
              Confirm password
            </label>
            <input
              id="reset-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className="input-field"
              placeholder="Repeat password"
            />
          </div>
          {error && (
            <p className="text-sm text-neutral-800 bg-neutral-50 px-4 py-2 rounded-xl">{error}</p>
          )}
          {info && (
            <p className="text-sm text-neutral-700 bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-xl">
              {info}
            </p>
          )}
          <button type="submit" disabled={loading || !tokenFromUrl} className="btn-primary w-full">
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-neutral-500">
          <Link href="/login" className="text-neutral-900 font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </motion.div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 text-center text-neutral-500 shadow-elevated">
            Loading…
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
