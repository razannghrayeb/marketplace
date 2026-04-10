const fs = require('fs')
const path = require('path')

/**
 * In the monorepo, Supabase keys often live only in the repo-root `.env`.
 * Merge them into `process.env` for this Next app when unset (does not override
 * `apps/marketplace/.env.local` — Next applies local env after this file runs;
 * values set here may be overwritten by Next's env loader depending on version).
 *
 * Next applies `.env*` before evaluating `next.config.js` for `next dev` / `build`,
 * so marketplace `.env.local` wins. We only fill missing keys from root `.env`.
 */
;(function mergeMonorepoRootEnv() {
  const rootEnv = path.join(__dirname, '..', '..', '.env')
  if (!fs.existsSync(rootEnv)) return

  const lines = fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)
  for (const line of lines) {
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
    if (!key || !val) continue
    const cur = process.env[key]
    if (cur === undefined || String(cur).trim() === '') {
      process.env[key] = val
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url && process.env.SUPABASE_URL?.trim()) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL.trim()
  }
  if (!anon && process.env.SUPABASE_ANON_KEY?.trim()) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY.trim()
  }
})()

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**', pathname: '/**' },
      { protocol: 'http', hostname: '**', pathname: '/**' },
    ],
  },
}

module.exports = nextConfig
