'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { mapApiUser } from '@/lib/auth/mapUser'
import { useAuthStore } from '@/store/auth'

const LS_EMAIL = 'tz-saved-login-email'
const LS_REMEMBER = 'tz-login-remember-me'
const LS_LAST_ACTIVITY = 'tz-last-activity-at'

function formatLoginError(res: { success?: boolean; error?: { message?: string } }): string {
  const msg = (res.error?.message || '').trim()
  const lower = msg.toLowerCase()
  if (lower.includes('invalid email') && lower.includes('password')) {
    return 'Incorrect email or password. Try again or use Forgot password below.'
  }
  if (lower.includes('deactivated')) {
    return 'This account is deactivated.'
  }
  return msg || 'Sign-in failed. Please check your details and try again.'
}

function formatLastActivity(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

function LoginFormInner() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [lastActivityLabel, setLastActivityLabel] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const flag = localStorage.getItem(LS_REMEMBER)
      const saved = localStorage.getItem(LS_EMAIL)
      if (saved) setEmail(saved)
      if (flag === '0') setRememberMe(false)
      else if (flag === '1' || saved) setRememberMe(true)
      else setRememberMe(true)

      const last = localStorage.getItem(LS_LAST_ACTIVITY)
      const formatted = last ? formatLastActivity(last) : ''
      if (formatted) setLastActivityLabel(formatted)
    } catch {
      /* ignore */
    }
  }, [])

  const safeReturnPath = (): string => {
    const next = searchParams.get('next')
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('..')) return next
    return '/'
  }

  const persistLoginPreferences = () => {
    const now = new Date().toISOString()
    try {
      localStorage.setItem(LS_LAST_ACTIVITY, now)
      if (rememberMe) {
        localStorage.setItem(LS_REMEMBER, '1')
        localStorage.setItem(LS_EMAIL, email.trim())
      } else {
        localStorage.setItem(LS_REMEMBER, '0')
        localStorage.removeItem(LS_EMAIL)
      }
      setLastActivityLabel(formatLastActivity(now))
    } catch {
      /* ignore */
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ user: { id: number; email: string }; access_token: string; refresh_token: string }>(
        endpoints.auth.login,
        { email, password }
      )
      const token = (res as { access_token?: string; accessToken?: string }).access_token ?? (res as { accessToken?: string }).accessToken
      const refresh =
        (res as { refresh_token?: string; refreshToken?: string }).refresh_token ??
        (res as { refreshToken?: string }).refreshToken
      const rawUser = (res as { user?: Parameters<typeof mapApiUser>[0] }).user
      if (res.success && rawUser && token) {
        persistLoginPreferences()
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
        else router.push(safeReturnPath())
        router.refresh()
      } else {
        setError(formatLoginError(res))
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
        <h1 className="font-display text-2xl font-bold text-neutral-800 text-center">Welcome back</h1>
        <p className="text-neutral-500 text-center mt-2">Sign in to your Bolden account</p>
        {lastActivityLabel && (
          <p className="text-center text-xs text-neutral-400 mt-2">
            Last activity on this browser: {lastActivityLabel}
          </p>
        )}
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-neutral-700 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-field"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor="login-password" className="block text-sm font-medium text-neutral-700">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-800"
            />
            Remember my email on this device
          </label>
          {error && (
            <p role="alert" className="text-sm text-neutral-800 bg-neutral-50 px-4 py-2 rounded-xl">
              {error}
            </p>
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
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 text-center text-neutral-500 shadow-elevated">
            Loading…
          </div>
        }
      >
        <LoginFormInner />
      </Suspense>
    </div>
  )
}
