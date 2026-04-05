import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

let browserClient: SupabaseClient<Database> | null = null
let adminClient: SupabaseClient<Database> | null = null

/** Placeholder only so Next can analyze routes when env is missing (e.g. CI); real requests need real env. */
const PLACEHOLDER_URL = 'https://placeholder.supabase.co'
const PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder'

function getOrCreateBrowser(): SupabaseClient<Database> {
  if (browserClient) return browserClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (url && key) {
    browserClient = createClient<Database>(url, key)
    return browserClient
  }
  browserClient = createClient<Database>(PLACEHOLDER_URL, PLACEHOLDER_KEY)
  return browserClient
}

function getOrCreateAdmin(): SupabaseClient<Database> {
  if (adminClient) return adminClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (url && service) {
    adminClient = createClient<Database>(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    return adminClient
  }
  if (url && anon) {
    adminClient = createClient<Database>(url, anon)
    return adminClient
  }
  adminClient = createClient<Database>(PLACEHOLDER_URL, PLACEHOLDER_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return adminClient
}

function proxiedClient(getter: () => SupabaseClient<Database>): SupabaseClient<Database> {
  return new Proxy({} as SupabaseClient<Database>, {
    get(_target, prop, receiver) {
      const client = getter()
      const value = Reflect.get(client, prop, receiver)
      if (typeof value === 'function') {
        return value.bind(client)
      }
      return value
    },
  })
}

export const supabase = proxiedClient(getOrCreateBrowser)

export const supabaseAdmin = proxiedClient(getOrCreateAdmin)
