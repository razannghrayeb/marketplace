'use client'

import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { Shirt, Upload, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export default function TryOnPage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const user = useAuthStore((s) => s.user)
  const [personFile, setPersonFile] = useState<File | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [debugResponse, setDebugResponse] = useState<unknown>(null)
  const personRef = useRef<HTMLInputElement>(null)
  const garmentRef = useRef<HTMLInputElement>(null)

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!personFile || !garmentFile) throw new Error('Both photos required')
      if (!user?.id) throw new Error('You must be signed in to use try-on')
      const formData = new FormData()
      formData.append('person_image', personFile)
      formData.append('garment_image', garmentFile)
      formData.append('category', 'upper_body')
      formData.append('user_id', String(user.id))
      const res = await api.postForm(endpoints.tryon.submit, formData)
      setDebugResponse({
        raw: res,
        userFromStore: user ? { id: user.id, email: user.email } : null,
        jobId: (res as { job?: { id?: string | number } })?.job?.id,
        success: (res as { success?: boolean }).success,
      })
      console.log('[TryOn] Response:', res)
      console.log('[TryOn] User from store:', user ? { id: user.id } : null)
      console.log('[TryOn] job.id:', (res as { job?: { id?: string | number } })?.job?.id)
      const payload = res as {
        success?: boolean
        job?: { id?: string | number }
        jobId?: string | number
        error?: string | { message?: string }
      }
      const err = payload.error
      if (payload.success === false && err) {
        const msg = typeof err === 'string' ? err : err?.message
        throw new Error(msg ?? 'Try-on request failed')
      }
      const jid = payload.job?.id ?? payload.jobId
      if (jid == null || jid === '') throw new Error('No job ID returned from try-on API')
      return String(jid)
    },
    onSuccess: (id) => setJobId(String(id)),
  })

  type TryOnJobPayload = {
    status?: string
    result_image_url?: string
    error_message?: string
  }

  function extractJobPayload(res: unknown): TryOnJobPayload | null {
    if (!res || typeof res !== 'object') return null
    const r = res as Record<string, unknown>
    if (r.job && typeof r.job === 'object') return r.job as TryOnJobPayload
    const data = r.data
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      if (d.job && typeof d.job === 'object') return d.job as TryOnJobPayload
    }
    return null
  }

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
    enabled: !!jobId,
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

  const jobStatus = job?.status?.toLowerCase()

  if (!isAuth) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Shirt className="w-16 h-16 text-neutral-300 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-neutral-800 mb-2">Sign in to try on</h2>
        <p className="text-neutral-500 mb-6">Virtual try-on requires an account.</p>
        <a href="/login" className="btn-primary">
          Sign in
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-neutral-800 mb-2">Virtual Try-On</h1>
        <p className="text-neutral-500 mb-10">
          Upload a photo of yourself and a garment to see how it looks on you. Powered by AI.
        </p>

        {jobStatus === 'completed' && job?.result_image_url ? (
          <div className="space-y-6">
            <p className="text-green-600 font-medium">Try-on complete!</p>
            <div className="relative aspect-[3/4] max-w-md rounded-2xl overflow-hidden bg-neutral-100">
              <Image
                src={job.result_image_url}
                alt="Try-on result"
                fill
                className="object-cover"
                unoptimized
              />
            </div>
            <button
              onClick={() => {
                setJobId(null)
                setPersonFile(null)
                setGarmentFile(null)
              }}
              className="btn-secondary"
            >
              Try another
            </button>
          </div>
        ) : jobStatus === 'failed' ? (
          <div className="p-6 rounded-2xl bg-neutral-100 border border-neutral-200 text-neutral-800">
            <p className="font-medium">Try-on failed</p>
            <p className="text-sm mt-1">{job?.error_message ?? 'Unknown error'}</p>
            <button
              onClick={() => setJobId(null)}
              className="btn-secondary mt-4"
            >
              Try again
            </button>
          </div>
        ) : jobPollError && jobId ? (
          <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-neutral-800">
            <p className="font-medium text-rose-900">Could not load try-on status</p>
            <p className="text-sm mt-1 text-rose-800">
              {(jobPollErr as Error)?.message ?? 'Check your connection and try again.'}
            </p>
            <p className="text-xs mt-2 text-neutral-600">
              If this keeps happening, the job may belong to a different account (user id must match) or the server may be misconfigured.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <button type="button" onClick={() => setJobId(null)} className="btn-secondary">
                Start over
              </button>
            </div>
          </div>
        ) : jobId && (polling || jobStatus === 'processing' || jobStatus === 'pending') ? (
          <div className="p-12 rounded-2xl bg-neutral-50 border border-neutral-200 text-center">
            <Loader2 className="w-12 h-12 text-violet-600 animate-spin mx-auto mb-4" />
            <p className="font-medium text-neutral-800">Processing your try-on...</p>
            <p className="text-sm text-neutral-500 mt-1">This may take 30–60 seconds</p>
            {stuckNotice && (
              <p className="text-sm text-amber-800 mt-4 max-w-md mx-auto">
                Still working after a few minutes? The server may need an update (background jobs on Cloud Run require inline processing). Try starting over or contact support.
              </p>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8">
            <input
              ref={personRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setPersonFile(e.target.files?.[0] || null)}
            />
            <input
              ref={garmentRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setGarmentFile(e.target.files?.[0] || null)}
            />
            <div
              onClick={() => personRef.current?.click()}
              className="p-8 rounded-2xl bg-neutral-50 border-2 border-dashed border-neutral-200 text-center cursor-pointer hover:border-violet-300 transition-colors"
            >
              {personFile ? (
                <p className="font-medium text-neutral-800">{personFile.name}</p>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-neutral-400 mx-auto mb-4" />
                  <h3 className="font-medium text-neutral-800 mb-2">Your photo</h3>
                  <p className="text-sm text-neutral-500 mb-4">Upload a full-body or upper-body photo</p>
                  <span className="btn-secondary inline-block">Choose file</span>
                </>
              )}
            </div>
            <div
              onClick={() => garmentRef.current?.click()}
              className="p-8 rounded-2xl bg-neutral-50 border-2 border-dashed border-neutral-200 text-center cursor-pointer hover:border-violet-300 transition-colors"
            >
              {garmentFile ? (
                <p className="font-medium text-neutral-800">{garmentFile.name}</p>
              ) : (
                <>
                  <Shirt className="w-12 h-12 text-neutral-400 mx-auto mb-4" />
                  <h3 className="font-medium text-neutral-800 mb-2">Garment</h3>
                  <p className="text-sm text-neutral-500 mb-4">Upload a photo of the garment</p>
                  <span className="btn-secondary inline-block">Choose file</span>
                </>
              )}
            </div>
          </div>
        )}

        {personFile && garmentFile && !jobId && (
          <div className="mt-8">
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Start try-on'
              )}
            </button>
            {submitMutation.isError && (
              <p className="mt-2 text-sm text-neutral-700">{(submitMutation.error as Error)?.message}</p>
            )}
            {debugResponse !== null && debugResponse !== undefined && (
              <pre className="mt-4 p-4 text-xs bg-neutral-100 rounded-xl overflow-auto max-h-48 font-mono text-neutral-700">
                {JSON.stringify(debugResponse, null, 2)}
              </pre>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
