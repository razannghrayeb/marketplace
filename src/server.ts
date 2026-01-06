import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { healthRouter } from "./routes/health";
import { searchRouter } from "./routes/search";


export async function createServer() {
const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "5mb" }));


app.use("/health", healthRouter);
app.use("/search", searchRouter); // text+image stubs for now


app.get("/", (_req, res) => res.json({ ok: true }));
return app;
}