import { pg } from "../src/lib/db";
import { osClient } from "../src/lib/opensearch";
import { config } from "../src/config";
import { buildProductSearchDocument } from "../src/lib/search/searchDocument";


async function main() {
    const v = await pg.query(
    `INSERT INTO vendors(name, url) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`,
    ["Demo Boutique", "https://demo.example"]
    );
    const vendorId = v.rows[0]?.id || (await pg.query("SELECT id FROM vendors WHERE name=$1", ["Demo Boutique"]))
    .rows[0].id;


    const products = [
    { title: "Nike Air Tee", brand: "Nike", category: "tops", price_cents: 1200000, availability: true, image_url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400" },
    { title: "Adidas Runner Shorts", brand: "Adidas", category: "bottoms", price_cents: 900000, availability: true, image_url: "https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=400" },
    { title: "Levi's 501 Jeans", brand: "Levi's", category: "bottoms", price_cents: 2700000, availability: false, image_url: "https://images.unsplash.com/photo-1542272604-787c3835535d?w=400" }
    ];
        for (const p of products) {
            const ins = await pg.query(
            `INSERT INTO products(vendor_id,title,brand,category,currency,price_cents,availability,image_url)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,last_seen`,
            [vendorId, p.title, p.brand, p.category, "LBP", p.price_cents, p.availability, p.image_url]
            );
            const product = ins.rows[0];
            await osClient.index({
                index: config.opensearch.index,
                id: String(product.id),
                body: buildProductSearchDocument({
                  productId: product.id,
                  vendorId,
                  title: p.title,
                  description: null,
                  brand: p.brand,
                  category: p.category,
                  priceCents: p.price_cents,
                  availability: p.availability,
                  isHidden: false,
                  canonicalId: null,
                  imageCdn: null,
                  pHash: null,
                  lastSeenAt: product.last_seen,
                }),
                refresh: true
                });
        }
        console.log("seeded", products.length, "products");
        process.exit(0);
}


main().catch(e => { console.error(e); process.exit(1); });