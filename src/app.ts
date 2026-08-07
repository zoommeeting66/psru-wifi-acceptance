import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/error";
import apiRouter from "./routes";
import authRouter from "./routes/auth";
import { requireAuth } from "./middleware/auth";

export function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", requireAuth, apiRouter);

  app.get("/m", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "m.html")));

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use("/api", (_req, res) => res.status(404).json({ error: "ไม่พบเส้นทางที่ร้องขอ" }));
  app.use(errorHandler);

  return app;
}
