'use client'

import { useState, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { Shirt, Upload, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export default function TryOnPage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const [personFile, setPersonFile] = useState<File | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const personRef = useRef<HTMLInputElement>(null)
  const garmentRef = useRef<HTMLInputElement>(null)

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!personFile || !garmentFile) throw new Error('Both photos required')
      const formData = new FormData()
      formData.append('person_image', personFile)
      formData.append('garment_image', garmentFile)
      formData.append('category', 'upper_body')
      const res = await api.postForm(endpoints.tryon.submit, formData)
      const job = (res as { job?: { id?: string | number } })?.job
      if (job?.id == null) throw new Error('No job ID returned')
      return String(job.id)
    },
    onSuccess: (id) => setJobId(String(id)),
  })

  const { data: job, isLoading: polling } = useQuery({
    queryKey: ['tryon-job', jobId],
    queryFn: async () => {
      const res = await api.get<{ job?: { status?: string; result_image_url?: string; error_message?: string } }>(
        endpoints.tryon.job(jobId!)
      )
      return (res as { job?: { status?: string; result_image_url?: string; error_message?: string } })?.job
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'completed' || status === 'failed' ? false : 2000
    },
  })

  if (!isAuth) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Shirt className="w-16 h-16 text-charcoal-300 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-charcoal-800 mb-2">Sign in to try on</h2>
        <p className="text-charcoal-500 mb-6">Virtual try-on requires an account.</p>
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
        <h1 className="font-display text-3xl font-bold text-charcoal-800 mb-2">Virtual Try-On</h1>
        <p className="text-charcoal-500 mb-10">
          Upload a photo of yourself and a garment to see how it looks on you. Powered by AI.
        </p>

        {job?.status === 'completed' && job?.result_image_url ? (
          <div className="space-y-6">
            <p className="text-green-600 font-medium">Try-on complete!</p>
            <div className="relative aspect-[3/4] max-w-md rounded-2xl overflow-hidden bg-cream-200">
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
        ) : job?.status === 'failed' ? (
          <div className="p-6 rounded-2xl bg-wine-50 border border-wine-200 text-wine-700">
            <p className="font-medium">Try-on failed</p>
            <p className="text-sm mt-1">{job?.error_message ?? 'Unknown error'}</p>
            <button
              onClick={() => setJobId(null)}
              className="btn-secondary mt-4"
            >
              Try again
            </button>
          </div>
        ) : jobId && (polling || job?.status === 'processing' || job?.status === 'pending') ? (
          <div className="p-12 rounded-2xl bg-cream-100 border border-cream-300 text-center">
            <Loader2 className="w-12 h-12 text-wine-600 animate-spin mx-auto mb-4" />
            <p className="font-medium text-charcoal-800">Processing your try-on...</p>
            <p className="text-sm text-charcoal-500 mt-1">This may take 30–60 seconds</p>
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
              className="p-8 rounded-2xl bg-cream-100 border-2 border-dashed border-cream-300 text-center cursor-pointer hover:border-wine-300 transition-colors"
            >
              {personFile ? (
                <p className="font-medium text-charcoal-800">{personFile.name}</p>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-charcoal-400 mx-auto mb-4" />
                  <h3 className="font-medium text-charcoal-800 mb-2">Your photo</h3>
                  <p className="text-sm text-charcoal-500 mb-4">Upload a full-body or upper-body photo</p>
                  <span className="btn-secondary inline-block">Choose file</span>
                </>
              )}
            </div>
            <div
              onClick={() => garmentRef.current?.click()}
              className="p-8 rounded-2xl bg-cream-100 border-2 border-dashed border-cream-300 text-center cursor-pointer hover:border-wine-300 transition-colors"
            >
              {garmentFile ? (
                <p className="font-medium text-charcoal-800">{garmentFile.name}</p>
              ) : (
                <>
                  <Shirt className="w-12 h-12 text-charcoal-400 mx-auto mb-4" />
                  <h3 className="font-medium text-charcoal-800 mb-2">Garment</h3>
                  <p className="text-sm text-charcoal-500 mb-4">Upload a photo of the garment</p>
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
              <p className="mt-2 text-sm text-wine-600">{(submitMutation.error as Error)?.message}</p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
