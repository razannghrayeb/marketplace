'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Search, Image, Sparkles, Shirt, TrendingUp, Zap } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductGrid } from '@/components/product/ProductGrid'
import { SearchBar } from '@/components/search/SearchBar'

const FALLBACK_BRANDS = ['Zara', 'H&M', 'Nike', 'Adidas', 'Mango', 'Uniqlo', 'Levi\'s', 'Gucci', 'Prada', 'Everlane']

function BrandsMarquee() {
  const { data } = useQuery({
    queryKey: ['facets'],
    queryFn: async () => {
      const res = await api.get<{ data?: { brands?: Array<{ value: string; count: number }> } }>(endpoints.products.facets)
      return res
    },
  })

  const brands = (data?.data as { brands?: Array<{ value: string }> })?.brands?.map((b) => b.value) ?? FALLBACK_BRANDS
  const displayBrands = brands.length > 0 ? brands : FALLBACK_BRANDS

  return (
    <div className="overflow-hidden py-8 border-y border-cream-300 bg-white/50">
      <motion.div
        animate={{ x: [0, -600] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="inline-flex gap-12 whitespace-nowrap"
      >
        {[...displayBrands, ...displayBrands].map((brand, i) => (
          <span key={`${brand}-${i}`} className="text-lg font-display font-semibold text-charcoal-400">
            {brand}
          </span>
        ))}
      </motion.div>
    </div>
  )
}

function CategoryChart() {
  const { data } = useQuery({
    queryKey: ['facets-chart'],
    queryFn: async () => {
      const res = await api.get<{ data?: { categories?: Array<{ value: string; count: number }> } }>(endpoints.products.facets)
      return res
    },
  })

  const categories = (data?.data as { categories?: Array<{ value: string; count: number }> })?.categories?.slice(0, 8) ?? []
  const chartData = categories.map((c) => ({ name: c.value || 'Other', count: c.count }))
  const colors = ['#722F37', '#8B3A42', '#A44B54', '#C9A86C', '#D4B87A', '#E8DDD2', '#9CA3AF', '#6B7280']

  if (chartData.length === 0) return null

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-cream-100 via-cream-50 to-gold-50">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-wine-100/40 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-gold-100/30 via-transparent to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-wine-600 font-medium uppercase tracking-widest text-sm mb-4"
            >
              AI-Powered Fashion Discovery
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-charcoal-800 leading-tight"
            >
              Find your style with{' '}
              <span className="text-wine-700">intelligence</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-6 text-lg text-charcoal-600 max-w-2xl mx-auto"
            >
              Search by text, upload an image, or mix styles from multiple looks. Virtual try-on, wardrobe management, and personalized recommendations — all powered by AI.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mt-10"
            >
              <SearchBar variant="hero" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Brands marquee */}
      <BrandsMarquee />

      {/* About / Intro */}
      <section className="py-20 lg:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto text-center"
          >
            <h2 className="font-display text-3xl lg:text-4xl font-bold text-charcoal-800 mb-6">
              About StyleAI
            </h2>
            <p className="text-lg text-charcoal-600 leading-relaxed mb-6">
              We&apos;re a fashion marketplace powered by artificial intelligence. Our platform aggregates products from multiple brands and vendors, giving you one place to discover, compare, and shop. Use natural language to search, upload photos to find similar items, or mix styles from multiple images to create your perfect look.
            </p>
            <p className="text-charcoal-600 leading-relaxed">
              Whether you&apos;re building a wardrobe, trying on clothes virtually, or hunting for the best deals — StyleAI brings intelligence to every step of your fashion journey.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 lg:py-24 bg-cream-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="font-display text-3xl font-bold text-charcoal-800 text-center mb-12"
          >
            How it works
          </motion.h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Search, title: 'Text Search', desc: 'Describe what you want in natural language.', href: '/search' },
              { icon: Image, title: 'Visual Search', desc: 'Upload a photo and find similar products.', href: '/search?mode=image' },
              { icon: Sparkles, title: 'Mix & Match', desc: 'Combine styles from multiple images.', href: '/search?mode=multi' },
              { icon: Shirt, title: 'Virtual Try-On', desc: 'See how garments look on you before buying.', href: '/try-on' },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <Link
                  href={item.href}
                  className="block p-6 rounded-2xl bg-white border border-cream-300 hover:border-wine-200 hover:shadow-elevated transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-wine-100 flex items-center justify-center mb-4 group-hover:bg-wine-200 transition-colors">
                    <item.icon className="w-6 h-6 text-wine-700" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-charcoal-800 mb-2">{item.title}</h3>
                  <p className="text-sm text-charcoal-600">{item.desc}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories chart */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-cream-100 rounded-2xl p-8 border border-cream-300"
          >
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="w-6 h-6 text-wine-600" />
              <h2 className="font-display text-2xl font-bold text-charcoal-800">Shop by category</h2>
            </div>
            <CategoryChart />
          </motion.div>
        </div>
      </section>

      {/* Featured products */}
      <section className="py-16 lg:py-24 bg-cream-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-10">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="flex items-center gap-2"
            >
              <Zap className="w-6 h-6 text-wine-600" />
              <h2 className="font-display text-3xl font-bold text-charcoal-800">Discover</h2>
            </motion.div>
            <Link
              href="/products"
              className="text-wine-700 font-medium hover:text-wine-800 transition-colors"
            >
              View all →
            </Link>
          </div>
          <ProductGrid limit={8} />
        </div>
      </section>
    </div>
  )
}
