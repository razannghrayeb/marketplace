'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Shirt, Plus, X, Upload } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'

export default function WardrobePage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['wardrobe'],
    queryFn: async () => {
      const res = await api.get<{ items?: unknown[] }>(endpoints.wardrobe.items)
      return res as { items?: unknown[] }
    },
    enabled: isAuth,
  })

  const addMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('source', 'uploaded')
      const res = await api.postForm(endpoints.wardrobe.items, formData)
      if ((res as { success?: boolean }).success === false) {
        throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Upload failed')
      }
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wardrobe'] })
      setShowAddModal(false)
    },
  })

  const handleAddClick = () => {
    setShowAddModal(true)
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) addMutation.mutate(file)
    e.target.value = ''
  }

  if (!isAuth) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Shirt className="w-16 h-16 text-charcoal-300 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-charcoal-800 mb-2">Sign in for your wardrobe</h2>
        <p className="text-charcoal-500 mb-6">Upload your clothes, get style suggestions, and complete looks.</p>
        <a href="/login" className="btn-primary">
          Sign in
        </a>
      </div>
    )
  }

  const items = ((data as { items?: unknown[] })?.items ?? []) as Array<{ id: number; name?: string; category?: string; image_url?: string; image_cdn?: string }>

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <h1 className="font-display text-3xl font-bold text-charcoal-800">My Wardrobe</h1>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="flex flex-col items-end gap-2">
          {addMutation.isError && (
            <p className="text-sm text-wine-600">{(addMutation.error as Error)?.message ?? 'Upload failed'}</p>
          )}
          <button
            onClick={handleAddClick}
            disabled={addMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {addMutation.isPending ? (
              <>Uploading...</>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Add item
              </>
            )}
          </button>
        </div>
      </motion.div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-square rounded-2xl bg-cream-200 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 bg-cream-100 rounded-2xl border border-cream-300">
          <Shirt className="w-16 h-16 text-charcoal-300 mx-auto mb-4" />
          <p className="text-charcoal-600 mb-6">Your wardrobe is empty</p>
          <p className="text-sm text-charcoal-500 mb-6">Upload photos of your clothes to get AI-powered style suggestions.</p>
          {addMutation.isError && (
            <p className="text-sm text-wine-600 bg-wine-50 px-4 py-2 rounded-xl mb-4 max-w-md mx-auto">
              {(addMutation.error as Error)?.message ?? 'Upload failed'}
            </p>
          )}
          <button
            onClick={handleAddClick}
            disabled={addMutation.isPending}
            className="btn-primary flex items-center gap-2 mx-auto"
          >
            <Plus className="w-4 h-4" />
            Add your first item
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {items.map((item: any, i: number) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="aspect-square rounded-2xl bg-cream-200 overflow-hidden border border-cream-300"
            >
              {(item.image_url || item.image_cdn) ? (
                <img src={item.image_cdn || item.image_url} alt={item.name || 'Item'} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Shirt className="w-12 h-12 text-charcoal-400" />
                </div>
              )}
              <div className="p-3 bg-white">
                <p className="font-medium text-charcoal-800 truncate">{item.name}</p>
                <p className="text-xs text-charcoal-500">{item.category}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
