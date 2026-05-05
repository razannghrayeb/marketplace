'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import Image from 'next/image'
import {
  Shirt,
  Upload,
  Loader2,
  Sparkles,
  Download,
  Share2,
  CheckCircle2,
  ArrowRight,
  User,
  RefreshCcw,
  X,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth'
import { useTryOn } from '@/context/try-on-context'
import { TryOnCompleteStylePanel } from '@/components/try-on/TryOnCompleteStylePanel'
import { TryOnMarketingHero } from '@/components/try-on/TryOnMarketingHero'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

const TRYON_SHOP_SESSION_KEY = 'styleai_tryon_shop_payload'

function TryOnUploadCard({
  title,
  subtitle,
  icon: Icon,
  previewUrl,
  fileLabel,
  inputRef,
  onFile,
  onClear,
  aspectClass,
}: {
  title: string
  subtitle: string
  icon: LucideIcon
  previewUrl: string | null
  fileLabel: string | null
  inputRef: React.MutableRefObject<HTMLInputElement | null>
  onFile: (f: File) => void
  onClear: () => void
  aspectClass: string
}) {
  const [dragOver, setDragOver] = useState(false)

  const pickFromList = (files: FileList | null) => {
    const f = files?.[0]
    if (f?.type.startsWith('image/')) onFile(f)
  }

  return (
    <div className="relative rounded-[28px] bg-white p-6 sm:p-7 shadow-[0_14px_44px_-26px_rgba(42,38,35,0.15)] ring-1 ring-[#ebe8e4]">
      <div className="flex gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-muted text-brand ring-1 ring-brand/12">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold text-[#2a2623]">{title}</h3>
          <p className="mt-1 text-sm text-[#7a726b]">{subtitle}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickFromList(e.target.files)}
      />

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          pickFromList(e.dataTransfer.files)
        }}
        className={clsx(
          'relative mt-5 cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
          dragOver ? 'border-brand bg-brand-muted/60' : 'border-[#d8d2cd] bg-[#faf9f7]/80 hover:border-brand/35 hover:bg-brand-muted/25',
        )}
      >
        {previewUrl ? (
          <div className={clsx('relative mx-auto w-full max-w-[220px] overflow-hidden rounded-xl bg-[#f3f1ee] ring-1 ring-[#ebe8e4]', aspectClass)}>
            <Image src={previewUrl} alt="" fill className="object-cover" unoptimized />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-md ring-2 ring-white/90 transition hover:bg-brand-hover"
              aria-label="Remove image"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="py-4">
            <Upload className="mx-auto h-8 w-8 text-[#c4bbb2]" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-[#2a2623]">Drag & drop</p>
            <p className="mt-1 text-xs text-[#7a726b]">or click to upload an image</p>
          </div>
        )}
        {fileLabel ? (
          <p className="mt-3 truncate px-2 text-[11px] text-[#9c9590]" title={fileLabel}>
            {fileLabel}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default function TryOnPage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const [personFile, setPersonFile] = useState<File | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const personRef = useRef<HTMLInputElement>(null)
  const garmentRef = useRef<HTMLInputElement>(null)

  const personPreview = useMemo(
    () => (personFile ? URL.createObjectURL(personFile) : null),
    [personFile],
  )
  const garmentPreview = useMemo(
    () => (garmentFile ? URL.createObjectURL(garmentFile) : null),
    [garmentFile],
  )

  useEffect(() => {
    return () => {
      if (personPreview) URL.revokeObjectURL(personPreview)
    }
  }, [personPreview])

  useEffect(() => {
    return () => {
      if (garmentPreview) URL.revokeObjectURL(garmentPreview)
    }
  }, [garmentPreview])

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
    lastGarmentFile,
  } = useTryOn()

  const resultUrl = job?.result_image_url
  const showCompleteStyle = jobStatus === 'completed' && !!resultUrl
  const garmentForStyle = lastGarmentFile ?? garmentFile

  const heroActiveStep = useMemo((): 1 | 2 | 3 => {
    if (jobStatus === 'completed') return 3
    if (jobId && (polling || jobStatus === 'processing' || jobStatus === 'pending')) return 3
    if (personFile && garmentFile) return 3
    if (personFile || garmentFile) return 2
    return 1
  }, [jobStatus, jobId, polling, personFile, garmentFile])

  const handleShareResult = async () => {
    if (!resultUrl) return
    try {
      await navigator.clipboard.writeText(resultUrl)
      setCopyDone(true)
      window.setTimeout(() => setCopyDone(false), 2000)
    } catch {
      window.open(resultUrl, '_blank', 'noopener,noreferrer')
    }
  }

  if (!isAuth) {
    return (
      <div className="min-h-screen bg-[#F9F8F6]">
        <TryOnMarketingHero
          activeStep={1}
          signInSlot={
            <Link href="/login?next=%2Ftry-on" className="btn-primary mt-1 inline-flex items-center gap-2">
              Sign in to continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <TryOnMarketingHero activeStep={heroActiveStep} />

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          {showCompleteStyle ? (
            <div className="mb-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  clearTryOn()
                  setPersonFile(null)
                  setGarmentFile(null)
                }}
                className="btn-secondary inline-flex items-center gap-2 text-sm"
              >
                <RefreshCcw className="h-4 w-4" aria-hidden />
                Try another image
              </button>
            </div>
          ) : null}
          {jobStatus === 'completed' && resultUrl ? (
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-7">
                <div className="overflow-hidden rounded-[22px] border border-[#ebe8e4] bg-white shadow-[0_8px_30px_-12px_rgba(42,38,35,0.12)] ring-1 ring-black/[0.04]">
                  <div className="flex items-center justify-between border-b border-[#ebe8e4] bg-[#faf9f7] px-5 py-3">
                    <div className="flex items-center gap-2 text-[#2a2623]">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-brand" aria-hidden />
                      <span className="text-sm font-semibold">Try-on complete</span>
                    </div>
                    <span className="text-xs font-medium text-[#9c9590]">Result preview</span>
                  </div>
                  {/* Full image visible — no portrait crop (avoid fixed aspect + object-cover). */}
                  <div className="flex w-full justify-center bg-[#f3f1ee] px-2 py-3 sm:px-4">
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote dimensions unknown; contain fit */}
                    <img
                      src={resultUrl}
                      alt="Try-on result"
                      className="mx-auto h-auto max-h-[min(78vh,820px)] w-full max-w-full object-contain object-center"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-6 lg:col-span-5">
                <div className="rounded-[22px] border border-[#ebe8e4] bg-white p-5 shadow-[0_8px_30px_-12px_rgba(42,38,35,0.08)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9c9590]">Actions</p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <a
                      href={resultUrl}
                      download="styleai-try-on.jpg"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:bg-brand-hover"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      Open / save image
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleShareResult()}
                      className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm"
                    >
                      <Share2 className="h-4 w-4" aria-hidden />
                      {copyDone ? 'Link copied' : 'Copy image URL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearTryOn()
                        setPersonFile(null)
                        setGarmentFile(null)
                      }}
                      className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm"
                    >
                      <RefreshCcw className="h-4 w-4" aria-hidden />
                      Try another image
                    </button>
                  </div>
                  <p className="mt-4 text-xs text-[#7a726b]">
                    Tip: copy the URL to share with friends, or save from the opened tab if your browser blocks downloads
                    for remote images.
                  </p>
                </div>

                <div className="rounded-[22px] border border-[#ebe8e4] bg-gradient-to-b from-white to-[#faf9f7] p-6 shadow-[0_8px_30px_-12px_rgba(42,38,35,0.08)]">
                  <TryOnCompleteStylePanel
                    garmentFile={garmentForStyle}
                    jobId={jobId}
                    enabled={showCompleteStyle}
                  />
                </div>

                <div className="rounded-[22px] border border-[#ebe8e4] bg-[#faf9f7]/90 p-5">
                  <p className="text-sm font-semibold text-[#2a2623]">Keep shopping</p>
                  <p className="mt-1 text-xs text-[#7a726b]">Browse pieces that match your vibe.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href="/products"
                      className="rounded-full border-2 border-brand/35 bg-white px-4 py-2 text-xs font-semibold text-brand transition hover:bg-brand-muted"
                    >
                      Shop all
                    </Link>
                    <Link
                      href="/sales"
                      className="rounded-full border-2 border-brand/35 bg-white px-4 py-2 text-xs font-semibold text-brand transition hover:bg-brand-muted"
                    >
                      Sale
                    </Link>
                    <Link
                      href="/search"
                      className="rounded-full border-2 border-brand/35 bg-white px-4 py-2 text-xs font-semibold text-brand transition hover:bg-brand-muted"
                    >
                      Discover
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : jobStatus === 'failed' ? (
            <div className="max-w-xl rounded-[22px] border border-[#ebe8e4] bg-white p-8 shadow-[0_8px_30px_-12px_rgba(42,38,35,0.1)]">
              <p className="font-display text-lg font-bold text-[#2a2623]">Try-on couldn&apos;t finish</p>
              <p className="mt-2 text-sm text-red-600">{job?.error_message ?? 'Unknown error'}</p>
              <button type="button" onClick={() => clearTryOn()} className="btn-primary mt-6">
                Start over
              </button>
            </div>
          ) : jobPollError && jobId ? (
            <div className="max-w-xl rounded-[22px] border border-[#ebe8e4] bg-white p-8 shadow-[0_8px_30px_-12px_rgba(42,38,35,0.1)]">
              <p className="font-semibold text-[#2a2623]">Couldn&apos;t load try-on status</p>
              <p className="mt-2 text-sm text-[#6b6560]">
                {(jobPollErr as Error)?.message ?? 'Check your connection and try again.'}
              </p>
              <p className="mt-3 text-xs text-[#9c9590]">
                If this persists, the job may belong to a different account or the server may be misconfigured.
              </p>
              <button type="button" onClick={() => clearTryOn()} className="btn-secondary mt-6">
                Start over
              </button>
            </div>
          ) : jobId && (polling || jobStatus === 'processing' || jobStatus === 'pending') ? (
            <div className="mx-auto max-w-lg rounded-[22px] border border-[#ebe8e4] bg-white p-12 text-center shadow-[0_8px_30px_-12px_rgba(42,38,35,0.12)]">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-muted">
                <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden />
              </div>
              <p className="font-display text-xl font-bold text-[#2a2623]">Processing your try-on</p>
              <p className="mt-2 text-sm text-[#6b6560]">Usually 30–60 seconds. Safe to browse the store meanwhile.</p>
              {stuckNotice && (
                <p className="mt-6 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Still waiting? The server may need a longer timeout. Try starting over or try again later.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-12">
              <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                  <TryOnUploadCard
                    title="Your photo"
                    subtitle="Upload a full-body or upper-body photo with good lighting."
                    icon={User}
                    previewUrl={personPreview}
                    fileLabel={personFile?.name ?? null}
                    inputRef={personRef}
                    onFile={setPersonFile}
                    onClear={() => setPersonFile(null)}
                    aspectClass="aspect-[3/4] min-h-[200px]"
                  />
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.06 }}
                >
                  <TryOnUploadCard
                    title="Garment"
                    subtitle="Upload a flat lay or product photo — clean background works best."
                    icon={Shirt}
                    previewUrl={garmentPreview}
                    fileLabel={garmentFile?.name ?? null}
                    inputRef={garmentRef}
                    onFile={setGarmentFile}
                    onClear={() => setGarmentFile(null)}
                    aspectClass="aspect-square min-h-[200px]"
                  />
                </motion.div>
              </div>

              {personFile && garmentFile && !jobId ? (
                <div className="flex flex-col items-center gap-3 px-2 text-center">
                  <button
                    type="button"
                    onClick={() => submitTryOn(personFile, garmentFile)}
                    disabled={isSubmitting}
                    className="btn-primary inline-flex min-w-[min(100%,280px)] items-center justify-center gap-2 px-10 py-4 text-base font-bold shadow-[0_12px_36px_-14px_rgba(61,48,48,0.45)] disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-5 w-5" aria-hidden />
                        Generate try-on
                      </>
                    )}
                  </button>
                  <p className="text-xs text-[#9c9590]">Powered by advanced AI technology</p>
                </div>
              ) : null}

              {submitError ? <p className="text-center text-sm text-[#7d4b3a]">{submitError.message}</p> : null}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
