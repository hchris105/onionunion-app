// server.js
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import adminApiRoutes from "./routes/admin.api.js";

// 可選：你的 auth 與 ask 檔案
import authRoutes from "./routes/auth.js";       // 若沒有可暫時註解
import askRouter from "./ask.js";                // 若沒有可暫時註解

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// ---- Mongo 連線 ----
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
await mongoose.connect(MONGODB_URI, {
  autoIndex: true,
});
console.log("[DB] connected");

// ---- 超輕量通用限流（可選；用你 .env 值）----
const COMMON_WINDOW = parseInt(process.env.RL_COMMON_WINDOW_MS || "900000", 10); // 15m
const COMMON_LIMIT = parseInt(process.env.RL_COMMON_LIMIT || "300", 10); // 300
const ipHits = new Map(); // key: ip, val: { cnt, ts }

function commonRateLimit(req, res, next) {
  if (!COMMON_WINDOW || !COMMON_LIMIT) return next();
  const now = Date.now();
  const ip = req.ip || req.connection?.remoteAddress || "0";
  let rec = ipHits.get(ip);
  if (!rec || now - rec.ts > COMMON_WINDOW) {
    rec = { cnt: 0, ts: now };
  }
  rec.cnt += 1;
  rec.ts = rec.ts || now;
  ipHits.set(ip, rec);
  if (rec.cnt > COMMON_LIMIT) {
    return res.status(429).json({
      ok: false,
      error: "rate_limited",
      detail: { windowMs: COMMON_WINDOW, limit: COMMON_LIMIT },
    });
  }
  res.set("RateLimit-Limit", String(COMMON_LIMIT));
  res.set("RateLimit-Remaining", String(Math.max(0, COMMON_LIMIT - rec.cnt)));
  res.set("RateLimit-Reset", String(Math.floor((rec.ts + COMMON_WINDOW) / 1000)));
  return next();
}

// ---- 健康檢查 ----
app.get("/healthz", (req, res) => {
  res.json({ ok: true, db: "up", ts: Date.now() });
});

// ---- Public 靜態資源（/public 與 /admin）----
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "public/admin")));

// ---- Admin.API 掛載（一定要在 /admin/api）----
app.use("/admin/api", commonRateLimit, adminApiRoutes);

// ---- Auth 路由（若你有）----
if (authRoutes) {
  app.use("/auth", authRoutes);
}

// ---- Ask 路由（若你有）----
if (askRouter) {
  app.use(commonRateLimit);      // 通用限流也套在 /ask
  app.post("/ask", askRouter);
}

// ---- 啟動 ----
const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`);
  const open = String(process.env.OPEN_REGISTER || "0");
  console.log(
    `[Server] OPEN_REGISTER=${open} (public /auth/register ${open === "1" ? "open" : "closed"})`
  );
});

