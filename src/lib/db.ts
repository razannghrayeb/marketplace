import { Pool } from "pg";
import { config } from "../config";
export const pg = new Pool(config.postgres);


export async function getProductsByIdsOrdered(ids: string[]) {
if (!ids.length) return [];
const res = await pg.query(
`SELECT * FROM products WHERE id = ANY($1)`, [ids.map(id => Number(id))]
);
// preserve OS order
const map = new Map(res.rows.map((r: any) => [String(r.id), r]));
return ids.map(id => map.get(id)).filter(Boolean);
}