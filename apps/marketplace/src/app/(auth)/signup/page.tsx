'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Store, ShoppingBag } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'
import type { UserType } from '@/store/auth'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userType, setUserType] = useState<UserType>('customer')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ user: { id: number; email: string; user_type?: UserType }; access_token: string; refresh_token: string }>(
        endpoints.auth.signup,
        { email, password, user_type: userType }
      )
      const token = (res as any).access_token ?? (res as any).accessToken
      const refresh = (res as any).refresh_token ?? (res as any).refreshToken
      const user = (res as any).user
      if (res.success && user && token) {
        const userWithType = { ...user, user_type: user.user_type ?? userType }
        setAuth(userWithType, token, refresh || token)
        const isBusiness = (user.user_type ?? userType) === 'business'
        router.push(isBusiness ? '/dashboard' : '/')
        router.refresh()
      } else {
        const err = (res as any).error
        setError(typeof err === 'string' ? err : err?.message || 'Signup failed')
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
        <div className="bg-white rounded-3xl shadow-elevated border border-cream-300 p-8">
          <h1 className="font-display text-2xl font-bold text-charcoal-800 text-center">Create account</h1>
          <p className="text-charcoal-500 text-center mt-2">Join StyleAI to save favorites and use your wardrobe</p>

          <div className="mt-6">
            <label className="block text-sm font-medium text-charcoal-700 mb-2">I am a</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setUserType('customer')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-colors ${
                  userType === 'customer'
                    ? 'border-wine-700 bg-wine-50 text-wine-800'
                    : 'border-cream-300 bg-cream-50 text-charcoal-600 hover:border-cream-400'
                }`}
              >
                <ShoppingBag className="w-5 h-5" />
                Customer / Buyer
              </button>
              <button
                type="button"
                onClick={() => setUserType('business')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 font-medium transition-colors ${
                  userType === 'business'
                    ? 'border-wine-700 bg-wine-50 text-wine-800'
                    : 'border-cream-300 bg-cream-50 text-charcoal-600 hover:border-cream-400'
                }`}
              >
                <Store className="w-5 h-5" />
                Business / Seller
              </button>
            </div>
            <p className="text-xs text-charcoal-400 mt-2">
              {userType === 'customer' ? 'Browse and buy fashion. Save favorites, use your wardrobe.' : 'Sell your products. Manage inventory and catalog.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-charcoal-700 mb-1">Email</label>
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
              <label className="block text-sm font-medium text-charcoal-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="input-field"
                placeholder="••••••••"
              />
              <p className="text-xs text-charcoal-400 mt-1">At least 8 characters</p>
            </div>
            {error && (
              <p className="text-sm text-wine-600 bg-wine-50 px-4 py-2 rounded-xl">{error}</p>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Creating account...' : 'Sign up'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-charcoal-500">
            Already have an account?{' '}
            <Link href="/login" className="text-wine-700 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
