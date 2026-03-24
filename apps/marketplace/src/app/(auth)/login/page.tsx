'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { mapApiUser } from '@/lib/auth/mapUser'
import { useAuthStore } from '@/store/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ user: { id: number; email: string }; access_token: string; refresh_token: string }>(
        endpoints.auth.login,
        { email, password }
      )
      const token = (res as any).access_token ?? (res as any).accessToken
      const refresh = (res as any).refresh_token ?? (res as any).refreshToken
      const rawUser = (res as any).user
      if (res.success && rawUser && token) {
        let user = mapApiUser(rawUser)
        setAuth(user, token, refresh || token)
        const meRes = (await api.get<unknown>(endpoints.auth.me)) as {
          success?: boolean
          user?: Parameters<typeof mapApiUser>[0]
        }
        if (meRes.success && meRes.user) {
          user = mapApiUser(meRes.user)
          setAuth(user, token, refresh || token)
        }
        if (user.is_admin) router.push('/admin')
        else if (user.user_type === 'business') router.push('/dashboard')
        else router.push('/')
        router.refresh()
      } else {
        const err = (res as any).error
        setError(typeof err === 'string' ? err : err?.message || 'Login failed')
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
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
          <h1 className="font-display text-2xl font-bold text-neutral-800 text-center">Welcome back</h1>
          <p className="text-neutral-500 text-center mt-2">Sign in to your StyleAI account</p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input-field"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-field"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-neutral-800 bg-neutral-50 px-4 py-2 rounded-xl">{error}</p>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-neutral-500">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-neutral-900 font-medium hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
