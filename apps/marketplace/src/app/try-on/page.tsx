'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { Shirt, Upload, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { useTryOn } from '@/context/try-on-context'

export default function TryOnPage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const [personFile, setPersonFile] = useState<File | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const personRef = useRef<HTMLInputElement>(null)
  const garmentRef = useRef<HTMLInputElement>(null)

  const {
    jobId,
    job,
    jobStatus,
    polling,
    jobPollError,
    jobPollErr,
    stuckNotice,
    isSubmitting,
    submitError,
    submitTryOn,
    clearTryOn,
  } = useTryOn()

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
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-3xl font-bold text-neutral-800 mb-2">Virtual Try-On</h1>
        <p className="text-neutral-500 mb-10">
          Upload a photo of yourself and a garment to see how it looks on you. You can leave this page — try-on keeps
          running; use the floating chip or return here anytime.
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
              type="button"
              onClick={() => {
                clearTryOn()
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
            <button type="button" onClick={() => clearTryOn()} className="btn-secondary mt-4">
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
              If this keeps happening, the job may belong to a different account (user id must match) or the server may
              be misconfigured.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <button type="button" onClick={() => clearTryOn()} className="btn-secondary">
                Start over
              </button>
            </div>
          </div>
        ) : jobId && (polling || jobStatus === 'processing' || jobStatus === 'pending') ? (
          <div className="p-12 rounded-2xl bg-neutral-50 border border-neutral-200 text-center">
            <Loader2 className="w-12 h-12 text-violet-600 animate-spin mx-auto mb-4" />
            <p className="font-medium text-neutral-800">Processing your try-on...</p>
            <p className="text-sm text-neutral-500 mt-1">This may take 30–60 seconds. You can browse the shop meanwhile.</p>
            {stuckNotice && (
              <p className="text-sm text-amber-800 mt-4 max-w-md mx-auto">
                Still working after a few minutes? The server may need a longer timeout or inline processing enabled. Try
                starting over or contact support.
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
              role="button"
              tabIndex={0}
              onClick={() => personRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && personRef.current?.click()}
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
              role="button"
              tabIndex={0}
              onClick={() => garmentRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && garmentRef.current?.click()}
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
              type="button"
              onClick={() => submitTryOn(personFile, garmentFile)}
              disabled={isSubmitting}
              className="btn-primary flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Start try-on'
              )}
            </button>
            {submitError && <p className="mt-2 text-sm text-neutral-700">{submitError.message}</p>}
          </div>
        )}
      </motion.div>
    </div>
  )
}
