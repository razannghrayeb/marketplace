import { Router } from "express";
export const searchRouter = Router();


// GET /search?q=shirt&brand=Nike
searchRouter.get("/", async (req, res) => {
// TODO: OpenSearch text query + hydrate from Postgres
res.json({ results: [], tookMs: 0 });
});


// POST /search/image (multipart or JSON { imageUrl })
searchRouter.post("/image", async (req, res) => {
// TODO: image upload -> CLIP embed -> kNN -> hydrate
res.json({ results: [], tookMs: 0 });
});