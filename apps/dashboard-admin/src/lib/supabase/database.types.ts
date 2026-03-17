// Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/lib/supabase/database.types.ts
// This stub satisfies TypeScript until you generate real types.

export type Database = {
  public: {
    Tables: {
      vendors: {
        Row: {
          id: number
          name: string
          url: string
          ship_to_lebanon: boolean
          created_at: string | null
        }
        Insert: Partial<Database['public']['Tables']['vendors']['Row']>
        Update: Partial<Database['public']['Tables']['vendors']['Insert']>
      }
      products: {
        Row: {
          id: number
          vendor_id: number
          product_url: string
          parent_product_url: string | null
          variant_id: string | null
          title: string
          brand: string | null
          category: string | null
          description: string | null
          size: string | null
          color: string | null
          currency: string | null
          price_cents: number | null
          sales_price_cents: number | null
          availability: boolean | null
          last_seen: string | null
          image_url: string | null
          image_urls: unknown
          image_cdn: string | null
          primary_image_id: number | null
          p_hash: string | null
          return_policy: string | null
        }
        Insert: Partial<Database['public']['Tables']['products']['Row']>
        Update: Partial<Database['public']['Tables']['products']['Insert']>
      }
      price_history: {
        Row: {
          id: number
          product_id: number
          price_cents: number
          sales_price_cents: number | null
          currency: string
          recorded_at: string
        }
        Insert: Partial<Database['public']['Tables']['price_history']['Row']>
        Update: Partial<Database['public']['Tables']['price_history']['Insert']>
      }
    }
    Functions: {
      get_overview_kpis: { Args: Record<never, never>; Returns: import('../../types').OverviewKPIs }
      get_vendor_stats: { Args: Record<never, never>; Returns: import('../../types').VendorStats[] }
      get_freshness_stats: { Args: Record<never, never>; Returns: import('../../types').FreshnessStats }
      get_category_counts: { Args: Record<never, never>; Returns: import('../../types').CategoryCount[] }
      get_vendor_product_counts: { Args: Record<never, never>; Returns: import('../../types').VendorProductCount[] }
      get_price_change_events: { Args: { limit_rows?: number }; Returns: import('../../types').PriceChangeEvent[] }
      get_daily_scrape_volume: { Args: { days_back?: number }; Returns: import('../../types').DailyScrapeStat[] }
    }
    Enums: Record<never, never>
  }
}
