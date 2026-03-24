import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export type UserType = 'customer' | 'business'

export interface User {
  id: number
  email: string
  user_type?: UserType
  /** Backend `users.is_admin` — needed for `/admin/*` */
  is_admin?: boolean
  created_at?: string
}

interface AuthState {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  logout: () => void
  /** Invalidate refresh token on server, then clear local session */
  logoutRemote: () => Promise<void>
  setUser: (user: User) => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      setAuth: (user, accessToken, refreshToken) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('accessToken', accessToken)
          localStorage.setItem('refreshToken', refreshToken)
        }
        set({ user, accessToken })
      },
      logout: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
        }
        set({ user: null, accessToken: null })
      },
      logoutRemote: async () => {
        if (typeof window !== 'undefined') {
          const refresh = localStorage.getItem('refreshToken')
          if (refresh) {
            await api.post(endpoints.auth.logout, { refresh_token: refresh }).catch(() => {})
          }
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
        }
        set({ user: null, accessToken: null })
      },
      setUser: (user) => set({ user }),
      isAuthenticated: () => {
        if (typeof window === 'undefined') return !!get().accessToken
        return !!localStorage.getItem('accessToken') || !!get().accessToken
      },
    }),
    { name: 'auth', partialize: (s) => ({ user: s.user }) }
  )
)
