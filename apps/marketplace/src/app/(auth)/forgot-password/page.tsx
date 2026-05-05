'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const res = await api.post<{ message?: string }>(endpoints.auth.forgotPassword, { email })
      if (res.success) {
        const msg =
          (res as { message?: string }).message ||
          'If an account exists for that email, you will receive reset instructions shortly.'
        setInfo(msg)
      } else {
        setError(res.error?.message || 'Something went wrong')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-3xl shadow-elevated border border-neutral-200 p-8">
          <h1 className="font-display text-2xl font-bold text-neutral-800 text-center">Reset password</h1>
          <p className="text-neutral-500 text-center mt-2">
            Enter your email and we&apos;ll send you a link to choose a new password.
          </p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium text-neutral-700 mb-1">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-field"
                placeholder="you@example.com"
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
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-neutral-500">
            <Link href="/login" className="text-neutral-900 font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
