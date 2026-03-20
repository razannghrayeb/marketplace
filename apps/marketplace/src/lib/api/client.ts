/**
 * API client for Fashion Marketplace backend (Render)
 * Backend uses snake_case: access_token, refresh_token
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://marketplace-933737368483.europe-west1.run.app'

export type ApiResponse<T> = {
  success: boolean
  data?: T
  meta?: { total?: number; page?: number; limit?: number; pages?: number }
  error?: { message: string; code?: string; details?: unknown }
}

function getUserIdFromStorage(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('auth')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const user = parsed?.state?.user
    const id = user?.id
    return typeof id === 'number' ? id : null
  } catch {
    return null
  }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('accessToken')
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const userId = getUserIdFromStorage()
  if (userId != null) headers['x-user-id'] = String(userId)
  return headers
}

async function handleResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        const refreshed = await refreshTokens(refreshToken)
        if (refreshed) {
          return fetch(res.url, { ...res, headers: await getAuthHeaders() }).then((r) => handleResponse<T>(r))
        }
      }
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      window.location.href = '/login'
    }
    const err = json?.error
    return { success: false, error: typeof err === 'string' ? { message: err } : (err || { message: res.statusText }) }
  }
  return json as ApiResponse<T>
}

export async function refreshTokens(refreshToken: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  const data = await res.json()
  const token = data?.access_token ?? data?.accessToken
  if (token && typeof window !== 'undefined') {
    localStorage.setItem('accessToken', token)
    const ref = data?.refresh_token ?? data?.refreshToken
    if (ref) localStorage.setItem('refreshToken', ref)
    return true
  }
  return false
}

export const api = {
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<ApiResponse<T>> {
    const url = new URL(path, API_BASE)
    if (params) {
      Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
    }
    const res = await fetch(url.toString(), { headers: await getAuthHeaders() })
    return handleResponse<T>(res)
  },

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  async postForm<T>(path: string, formData: FormData): Promise<ApiResponse<T>> {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { ...headers },
      body: formData,
    })
    return handleResponse<T>(res)
  },

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    })
    return handleResponse<T>(res)
  },
}
