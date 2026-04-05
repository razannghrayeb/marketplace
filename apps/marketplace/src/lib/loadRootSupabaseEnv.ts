/**
 * Merge repo-root `.env` into `process.env` when Next runs from `apps/marketplace`,
 * so Supabase keys only need to exist once (same as `dashboard-admin` / API).
 * Does not override vars already set by `apps/marketplace/.env.local`.
 */
import fs from 'fs'
import path from 'path'

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key) out[key] = val
  }
  return out
}

function mergeFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const parsed = parseDotEnv(fs.readFileSync(filePath, 'utf8'))
  for (const [k, v] of Object.entries(parsed)) {
    if (!v) continue
    const cur = process.env[k]
    if (cur === undefined || String(cur).trim() === '') {
      process.env[k] = v
    }
  }
}

const cwd = process.cwd()
const rootEnv = path.resolve(cwd, '..', '..', '.env')

mergeFile(rootEnv)

/** Root `.env` often uses `SUPABASE_URL` / `SUPABASE_ANON_KEY`; Next catalog code expects `NEXT_PUBLIC_*`. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
if (!url && process.env.SUPABASE_URL?.trim()) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL.trim()
}
if (!anon && process.env.SUPABASE_ANON_KEY?.trim()) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY.trim()
}
