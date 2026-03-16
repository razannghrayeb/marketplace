export type ScrapedProduct = {
  vendor_name: string;
  vendor_url: string;
  product_url: string;

  parent_product_url?: string | null;
  variant_id?: string | null;

  vendor_region?: string | null;
  return_policy?: string;
  title: string;
  brand?: string | null;

  category?: string | null;
  description?: string | null;
  size?: string | null;
  color?: string | null;

  currency: string;
  price_cents: number;
  sales_price_cents?: number | null;

  availability: boolean;
  last_seen?: string | null;

  image_url?: string | null;
  image_urls?: string[] | null;
};