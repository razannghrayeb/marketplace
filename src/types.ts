export type Product = {
    id: number;
    vendor_id: number;
    title: string;
    brand: string | null;
    category: string | null;
    url: string;
    currency: string;
    price_cents: number;
    sale_price_cents: number | null;
    availability: string | null;
    last_seen_at: string;
};
export type SearchFilters = {
    brand?: string;
    category?: string;
    priceMin?: number;
    priceMax?: number;
    vendorIds?: string[];
    titleQuery?: string;
};

export interface AuthUser {
  id: number;
  email: string;
  is_admin: boolean;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: Date;
  last_login: Date | null;
}

export interface CartItemRow {
  id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  added_at: Date;
}

export interface FavoriteRow {
  id: number;
  user_id: number;
  product_id: number;
  created_at: Date;
}
