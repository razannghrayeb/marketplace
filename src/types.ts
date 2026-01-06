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
};