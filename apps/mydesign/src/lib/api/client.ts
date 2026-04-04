import { endpoints } from './endpoints'

const TOKEN_KEY = 'mydesign_access_token'

export function getApiBase(): string {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:4000'
  return base
}

export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredAccessToken(token: string | null) {
  if (typeof window === 'undefined') return
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export type ApiFetchOptions = RequestInit & {
  skipAuth?: boolean
}

export async function apiFetch(path: string, init: ApiFetchOptions = {}): Promise<Response> {
  const { skipAuth, headers: initHeaders, ...rest } = init
  const headers = new Headers(initHeaders)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  const token = !skipAuth ? getStoredAccessToken() : null
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const url = path.startsWith('http')
    ? path
    : `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`
  return fetch(url, { ...rest, headers })
}

export async function apiJson<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const res = await apiFetch(path, init)
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const err = data as { error?: string; message?: string }
    throw new Error(err?.error || err?.message || res.statusText || `HTTP ${res.status}`)
  }
  return data as T
}

export { endpoints }
