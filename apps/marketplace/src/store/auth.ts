import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserType = 'customer' | 'business'

export interface User {
  id: number
  email: string
  user_type?: UserType
  created_at?: string
}

interface AuthState {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  logout: () => void
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
      isAuthenticated: () => {
        if (typeof window === 'undefined') return !!get().accessToken
        return !!localStorage.getItem('accessToken') || !!get().accessToken
      },
    }),
    { name: 'auth', partialize: (s) => ({ user: s.user }) }
  )
)
