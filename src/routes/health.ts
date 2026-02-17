import { Router } from "express";
import { osClient } from "../lib/core/index";
import { pg } from "../lib/core/index";


export const healthRouter = Router();


healthRouter.get("/ready", async (_req, res) => {
try {
// OpenSearch
const os = await osClient.cluster.health();
// Postgres
await pg.query("SELECT 1");
res.json({ ok: true, search: os.body.status, db: "ok" });
} catch (e) {
res.status(500).json({ ok: false, error: (e as Error).message });
}
});


healthRouter.get("/live", (_req, res) => res.json({ ok: true }));
