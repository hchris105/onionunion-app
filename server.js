// server.js — 穩定版（ESM）
// 依賴：express, dotenv, cors, helmet, compression, morgan, mongoose, path, fs
// 需要在 package.json 設定 { "type": "module" }

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
const DISABLE_ADMIN = ["1", "true", "yes"].includes(String(process.env.DISABLE_ADMIN || "").toLowerCase());

// ---- 預載 Model（避免 MissingSchemaError）----
try {
  await import("./models/User.js");
} catch (e) {
  console.warn("[Server] models/User.js not found or failed to import (ok if not needed)", e?.message || e);
}

// ---- 建立 App（注意順序！）----
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// 安全/壓縮/日誌/跨域/解析
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors()); // 若需限制來源可改成 cors({ origin: [...] })
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(morgan("combined"));

// ---- 健康檢查（永遠開）----
app.get("/healthz", (_req, res) => {
  const db = mongoose.connection?.readyState === 1 ? "up" : "down";
  res.json({ ok: true, db, ts: Date.now() });
});

// ---- /auth：先掛登入/註冊等（你原本的 routes/auth.js）----
try {
  const authRoutes = (await import("./routes/auth.js"))?.default;
  if (authRoutes) app.use("/auth", authRoutes);
} catch (e) {
  console.warn("[Auth] routes/auth.js not found – skipped");
}

// ---- /auth 認領：自助 claim（routes/claim.js）----
try {
  const claimRoutes = (await import("./routes/claim.js"))?.default;
  if (claimRoutes) {
    app.use("/auth", claimRoutes);
    console.log("[Claim] mounted /auth/preorder-lookup & /auth/claim");
  }
} catch (e) {
  console.warn("[Claim] routes/claim.js not found – skipped");
}

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
    console.log("[Gate] access middleware not a function – continue without gating");
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
    console.log("[Ask] route mounted");
  } else {
    app.post("/ask", (_req, res) =>
      res.json({ ok: true, used_model: "fake", answer: "【離線測試回覆】ask handler not found" })
    );
    console.warn("[Ask] ask.js export 非預期，已掛載假回覆（僅測試）");
  }
} catch {
  app.post("/ask", (_req, res) =>
    res.json({ ok: true, used_model: "fake", answer: "【離線測試回覆】routes/ask.js not found" })
  );
  console.warn("[Ask] routes/ask.js not found – mounted fake /ask for test");
}

// ---- 靜態頁：/admin 與根目錄 / ----
const ADMIN_DIR = path.join(__dirname, "public", "admin");
if (!DISABLE_ADMIN && fs.existsSync(ADMIN_DIR)) {
  app.use("/admin", express.static(ADMIN_DIR, { index: "index.html", extensions: ["html"] }));
  console.log("[Admin-Static] serving", ADMIN_DIR);
} else {
  console.log("[Admin-Static] skipped (DISABLE_ADMIN=1 或 public/admin/ 不存在)");
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
if (!DISABLE_ADMIN && ADMIN_ENABLE) {
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
  console.log("[Admin] API disabled (ADMIN_ENABLE=0 或 DISABLE_ADMIN=1)");
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
    // 不阻擋啟動；/healthz 仍可回應；Mongoose 會自行重試
  }
}
await connectDB();

app.listen(PORT, () => {
  console.log(`[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`);
  console.log(`[Server] Gate ${gateLoaded ? "ENABLED" : "DISABLED"}`);
  if (!OPEN_REGISTER) console.log("[Server] OPEN_REGISTER=0 (public /auth/register closed)");
});

export default app;
