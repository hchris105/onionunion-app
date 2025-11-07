// server.js — 穩定版：根目錄與 /admin 靜態頁、/auth 先掛、Gate 可選、/ask fallback、健康檢查
// ESM 版本（package.json 需是 "type": "module"）

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import mongoose from "mongoose";
import { fileURLToPath } from "url";

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- ENV ----
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
const ADMIN_ENABLE = ["1", "true", "yes"].includes(String(process.env.ADMIN_ENABLE || "").toLowerCase());
const OPEN_REGISTER = ["1", "true", "yes"].includes(String(process.env.OPEN_REGISTER || "").toLowerCase());

// ---- 預載 Model（避免 MissingSchemaError）----
try {
  await import("./models/User.js");
} catch (e) {
  console.warn("[Server] models/User.js not found or failed to import (ok if not needed)", e?.message || e);
}

// ---- 建立 App（注意順序！）----
const app = express();
app.disable("x-powered-by");

// 安全/壓縮/日誌/跨域/解析
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));

// ---- 健康檢查（永遠開）----
app.get("/healthz", (_req, res) => {
  const db = mongoose.connection?.readyState === 1 ? "up" : "down";
  res.json({ ok: true, db, ts: Date.now() });
});

// ---- /auth 先掛（不經 Gate）----
import authRoutes from "./routes/auth.js";
app.use("/auth", authRoutes);

// ---- Gate（可選；若沒有 middleware/auth.js 就跳過）----
let gateLoaded = false;
try {
  const gateMod = await import("./middleware/auth.js");
  const gate = gateMod?.default || gateMod;
  if (typeof gate === "function") {
    app.use(gate);
    gateLoaded = true;
    console.log("[Gate] access middleware enabled");
  } else {
    console.log("[Gate] access middleware not found – continue without gating");
  }
} catch {
  console.log("[Gate] access middleware not found – continue without gating");
}

// ---- /ask（支援 router 或 handler；若缺則給假回覆方便測試）----
try {
  const askMod = await import("./routes/ask.js");
  const askHandler = askMod?.askHandler || askMod?.default || askMod;
  if (typeof askHandler === "function" || askHandler?.stack) {
    app.use("/ask", askHandler);
  } else {
    app.post("/ask", (_req, res) =>
      res.json({ ok: true, used_model: "fake", answer: "【離線測試回覆】" })
    );
    console.warn("[Ask] ask.js export 非預期，已掛載假回覆（僅測試）");
  }
  console.log("[Ask] route mounted");
} catch {
  app.post("/ask", (_req, res) =>
    res.json({ ok: true, used_model: "fake", answer: "【離線測試回覆】" })
  );
  console.warn("[Ask] routes/ask.js not found – mounted fake /ask for test");
}

// ---- 靜態頁：/admin 與根目錄 / ----
const ADMIN_DIR = path.join(__dirname, "public", "admin");
if (fs.existsSync(ADMIN_DIR)) {
  app.use("/admin", express.static(ADMIN_DIR, { index: "index.html", extensions: ["html"] }));
  console.log("[Admin-Static] serving", ADMIN_DIR);
} else {
  console.log("[Admin-Static] public/admin/ not found – skip");
}

const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  // 提供網站首頁（/）與其他靜態資源
  app.use("/", express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"] }));
  console.log("[Public-Static] serving", PUBLIC_DIR);
} else {
  console.log("[Public-Static] public/index.html not found – root will 404");
}

// ---- （可選）/admin API：建議掛 /admin/api 以免與靜態頁衝突 ----
if (ADMIN_ENABLE) {
  try {
    const adminRoutes = (await import("./routes/admin.js"))?.default;
    if (adminRoutes) {
      app.use("/admin/api", adminRoutes);
      console.log("[Admin-API] mounted at /admin/api");
    } else {
      console.log("[Admin-API] routes/admin.js exists but no default export – skipped");
    }
  } catch {
    console.log("[Admin-API] routes/admin.js not found – skipped");
  }
} else {
  console.log("[Admin] DISABLED");
}

// ---- 404（最後）----
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

// ---- 啟動 Mongo 與 Server ----
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: "onionunion" });
    console.log("[DB] connected");
  } catch (e) {
    console.error("[DB] connect error:", e?.message || e);
    // 不阻擋啟動；/healthz 仍可回應；Mongoose 會自動重試
  }
}
await connectDB();

app.listen(PORT, () => {
  console.log(`[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`);
  console.log(`[Server] Gate ${gateLoaded ? "ENABLED" : "DISABLED"}`);
  if (!OPEN_REGISTER) console.log("[Server] OPEN_REGISTER=0 (public /auth/register closed)");
});

export default app;
