/**
 * API client for Fashion Marketplace backend (Render)
 * Backend uses snake_case: access_token, refresh_token
 */

/** Backend origin only (no trailing slash). Same join rules for GET and POST so paths stay consistent. */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'https://marketplace-933737368483.europe-west1.run.app').replace(
  /\/+$/,
  '',
)

function joinApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${p}`
}

const REACHABILITY_HINT =
  'Start the API from the repo root (pnpm dev), or point NEXT_PUBLIC_API_URL in apps/marketplace/.env.local at a running backend.'

async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Cannot reach API at ${API_BASE}. ${REACHABILITY_HINT}`)
    }
    throw e
  }
}

export type ApiResponse<T> = {
  success: boolean
  data?: T
  meta?: { total?: number; total_results?: number; page?: number; limit?: number; pages?: number }
  pagination?: { page?: number; limit?: number; total?: number; pages?: number }
  error?: { message: string; code?: string; details?: unknown }
  /** Some endpoints (e.g. POST /search/multi-image) return top-level fields */
  results?: unknown
}

function getUserIdFromStorage(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('auth')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const user = parsed?.state?.user
    const id = user?.id
    if (typeof id === 'number' && Number.isFinite(id)) return id
    if (typeof id === 'string') {
      const n = parseInt(id, 10)
      if (Number.isFinite(n)) return n
    }
    return null
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
          return apiFetch(res.url, { headers: await getAuthHeaders() }).then((r) => handleResponse<T>(r))
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
  const res = await apiFetch(joinApiUrl('/api/auth/refresh'), {
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
    const url = new URL(joinApiUrl(path))
    if (params) {
      Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
    }
    const res = await apiFetch(url.toString(), { headers: await getAuthHeaders() })
    return handleResponse<T>(res)
  },

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await apiFetch(joinApiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  async postForm<T>(path: string, formData: FormData): Promise<ApiResponse<T>> {
    const headers = await getAuthHeaders()
    const res = await apiFetch(joinApiUrl(path), {
      method: 'POST',
      headers: { ...headers },
      body: formData,
    })
    return handleResponse<T>(res)
  },

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await apiFetch(joinApiUrl(path), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await apiFetch(joinApiUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  /** For Prometheus `/metrics` and other non-JSON responses */
  async getRaw(path: string, params?: Record<string, string | number | undefined>): Promise<{
    ok: boolean
    status: number
    contentType: string
    body: string | Record<string, unknown>
  }> {
    const url = new URL(joinApiUrl(path))
    if (params) {
      Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
    }
    const res = await apiFetch(url.toString(), { headers: await getAuthHeaders() })
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: res.ok, status: res.status, contentType, body }
    }
    const text = await res.text()
    return { ok: res.ok, status: res.status, contentType, body: text }
  },

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    const res = await apiFetch(joinApiUrl(path), {
      method: 'DELETE',
      headers: await getAuthHeaders(),
    })
    return handleResponse<T>(res)
  },
}
