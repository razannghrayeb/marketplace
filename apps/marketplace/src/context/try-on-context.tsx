'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Loader2, Shirt } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { api, type ApiResponse } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

const TRYON_JOB_STORAGE_KEY = 'styleai_tryon_job_id'

export type TryOnJobPayload = {
  status?: string
  result_image_url?: string
  error_message?: string
}

function normalizeTryOnJob(raw: Record<string, unknown>): TryOnJobPayload {
  const status = (raw.status as string) ?? (raw.job_status as string)
  const resultUrl =
    (raw.result_image_url as string) ??
    (raw.resultImageUrl as string) ??
    (raw.result_url as string)
  const err =
    (raw.error_message as string) ?? (raw.errorMessage as string) ?? (raw.error as string)
  return {
    status,
    result_image_url: resultUrl,
    error_message: err,
  }
}

function extractJobPayload(res: unknown): TryOnJobPayload | null {
  if (!res || typeof res !== 'object') return null
  const r = res as Record<string, unknown>
  if (r.job && typeof r.job === 'object') return normalizeTryOnJob(r.job as Record<string, unknown>)
  const data = r.data
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.job && typeof d.job === 'object') return normalizeTryOnJob(d.job as Record<string, unknown>)
    if (
      typeof d.status === 'string' ||
      typeof d.job_status === 'string' ||
      typeof d.result_image_url === 'string' ||
      typeof d.resultImageUrl === 'string'
    ) {
      return normalizeTryOnJob(d)
    }
  }
  return null
}

/** POST /tryon returns `{ data: { job, jobId } }` (ApiResponse); older clients may return job fields at top level. */
function extractTryOnSubmitJobId(res: ApiResponse<unknown>): string | null {
  const r = res as Record<string, unknown>
  const container =
    r.data != null && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : r
  const job = container.job
  const fromJob =
    job && typeof job === 'object' ? (job as Record<string, unknown>).id : undefined
  const raw = fromJob ?? container.jobId ?? container.job_id
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  return s === '' ? null : s
}

type TryOnContextValue = {
  jobId: string | null
  job: TryOnJobPayload | undefined
  jobStatus: string | undefined
  polling: boolean
  jobPollError: boolean
  jobPollErr: Error | null
  stuckNotice: boolean
  isSubmitting: boolean
  submitError: Error | null
  /** Garment from the last submitted try-on (for “complete the look” after a session restore may be null). */
  lastGarmentFile: File | null
  /** Start try-on; continues in background if user navigates away */
  submitTryOn: (personFile: File, garmentFile: File) => void
  clearTryOn: () => void
}

const TryOnContext = createContext<TryOnContextValue | null>(null)

export function useTryOn() {
  const ctx = useContext(TryOnContext)
  if (!ctx) throw new Error('useTryOn must be used within TryOnProvider')
  return ctx
}

function TryOnBackgroundBanner() {
  const pathname = usePathname()
  const {
    jobId,
    job,
    jobStatus,
    polling,
    jobPollError,
    clearTryOn,
  } = useTryOn()

  if (pathname === '/try-on' || !jobId) return null

  const s = jobStatus

  if (jobPollError) {
    return (
      <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-2xl border border-[#d8c6bb] bg-white p-4 shadow-xl shadow-[#2a2623]/10">
        <p className="text-sm font-medium text-[#2a2623]">Try-on status unavailable</p>
        <p className="mt-1 text-xs text-neutral-600">Open Try On to retry or dismiss.</p>
        <div className="mt-3 flex gap-2">
          <Link
            href="/try-on"
            className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={clearTryOn}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600"
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  if (s === 'completed') {
    if (!job?.result_image_url) return null
    return (
      <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-2xl border border-emerald-200 bg-white p-4 shadow-xl shadow-emerald-500/10">
        <p className="text-sm font-medium text-emerald-800">Try-on ready</p>
        <Link
          href="/try-on"
          className="mt-2 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          View result
        </Link>
        <button
          type="button"
          onClick={clearTryOn}
          className="ml-2 text-xs text-neutral-500 underline"
        >
          Dismiss
        </button>
      </div>
    )
  }

  if (s === 'failed') {
    return (
      <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-2xl border border-amber-200 bg-white p-4 shadow-xl">
        <p className="text-sm font-medium text-neutral-800">Try-on finished with an error</p>
        <Link href="/try-on" className="mt-2 text-xs font-semibold text-[#2a2623]">
          See details →
        </Link>
      </div>
    )
  }

  const inFlight =
    polling || s === 'processing' || s === 'pending' || (s == null && !jobPollError)
  if (!inFlight && s !== 'completed' && s !== 'failed') return null

  return (
    <Link
      href="/try-on"
      className="fixed bottom-4 right-4 z-[60] flex max-w-[min(100vw-2rem,20rem)] items-center gap-3 rounded-2xl border border-[#d8c6bb] bg-white/95 px-4 py-3 shadow-xl shadow-[#2a2623]/15 backdrop-blur-sm transition hover:border-[#c9ae9f]"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f4ece6]">
        <Loader2 className="h-5 w-5 animate-spin text-[#2a2623]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900">Try-on in progress</p>
        <p className="text-xs text-neutral-500">Safe to browse — tap to view status</p>
      </div>
      <Shirt className="h-5 w-5 shrink-0 text-orange-500" aria-hidden />
    </Link>
  )
}

export function TryOnProvider({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const user = useAuthStore((s) => s.user)
  const [jobId, setJobId] = useState<string | null>(null)
  const [lastGarmentFile, setLastGarmentFile] = useState<File | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TRYON_JOB_STORAGE_KEY)
      if (raw && /^\d+$/.test(raw)) setJobId(raw)
    } catch {
      /* private mode */
    }
  }, [])

  useEffect(() => {
    try {
      if (jobId) sessionStorage.setItem(TRYON_JOB_STORAGE_KEY, jobId)
      else sessionStorage.removeItem(TRYON_JOB_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [jobId])

  useEffect(() => {
    if (!isAuth) {
      setJobId(null)
      setLastGarmentFile(null)
      try {
        sessionStorage.removeItem(TRYON_JOB_STORAGE_KEY)
      } catch {
        /* ignore */
      }
    }
  }, [isAuth])

  const submitMutation = useMutation({
    mutationFn: async ({
      personFile,
      garmentFile,
    }: {
      personFile: File
      garmentFile: File
    }) => {
      setLastGarmentFile(garmentFile)
      if (!user?.id) throw new Error('You must be signed in to use try-on')
      const formData = new FormData()
      formData.append('person_image', personFile)
      formData.append('garment_image', garmentFile)
      formData.append('category', 'upper_body')
      formData.append('user_id', String(user.id))
      const res = await api.postForm(endpoints.tryon.submit, formData)
      if (res.success === false && res.error) {
        throw new Error(res.error.message ?? 'Try-on request failed')
      }
      const jid = extractTryOnSubmitJobId(res)
      if (!jid) throw new Error('No job ID returned from try-on API')
      return jid
    },
    onSuccess: (id) => setJobId(String(id)),
  })

  const {
    data: job,
    isLoading: polling,
    isError: jobPollError,
    error: jobPollErr,
  } = useQuery({
    queryKey: ['tryon-job', jobId],
    queryFn: async () => {
      const res = await api.get<TryOnJobPayload>(endpoints.tryon.job(jobId!))
      if (res.success === false) {
        throw new Error(res.error?.message ?? 'Could not load try-on status')
      }
      const jobPayload = extractJobPayload(res)
      if (!jobPayload?.status) throw new Error('Invalid try-on response')
      return jobPayload
    },
    enabled: !!jobId && isAuth,
    retry: 2,
    retryDelay: 1500,
    refetchInterval: (query) => {
      const status = query.state.data?.status?.toLowerCase()
      if (status === 'completed' || status === 'failed') return false
      return 2500
    },
  })

  const [stuckNotice, setStuckNotice] = useState(false)
  useEffect(() => {
    const s = job?.status?.toLowerCase()
    if (!jobId || !job || s === 'completed' || s === 'failed') {
      setStuckNotice(false)
      return
    }
    const t = window.setTimeout(() => setStuckNotice(true), 120_000)
    return () => window.clearTimeout(t)
  }, [jobId, job?.status])

  const clearTryOn = useCallback(() => {
    setJobId(null)
    setLastGarmentFile(null)
    submitMutation.reset()
    try {
      sessionStorage.removeItem(TRYON_JOB_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [submitMutation])

  const submitTryOn = useCallback(
    (personFile: File, garmentFile: File) => {
      submitMutation.mutate({ personFile, garmentFile })
    },
    [submitMutation],
  )

  const jobStatus = job?.status?.toLowerCase()

  const value = useMemo<TryOnContextValue>(
    () => ({
      jobId,
      job,
      jobStatus,
      polling,
      jobPollError,
      jobPollErr: jobPollErr as Error | null,
      stuckNotice,
      isSubmitting: submitMutation.isPending,
      submitError: submitMutation.error as Error | null,
      lastGarmentFile,
      submitTryOn,
      clearTryOn,
    }),
    [
      jobId,
      job,
      jobStatus,
      polling,
      jobPollError,
      jobPollErr,
      stuckNotice,
      submitMutation.isPending,
      submitMutation.error,
      lastGarmentFile,
      submitTryOn,
      clearTryOn,
    ],
  )

  return (
    <TryOnContext.Provider value={value}>
      {children}
      {isAuth ? <TryOnBackgroundBanner /> : null}
    </TryOnContext.Provider>
  )
}
