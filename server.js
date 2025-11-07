// server.js — 穩定版（相容你原本的 150 行行為）
// - 根目錄與 /admin 靜態頁
// - 先掛 /auth
// - Gate（middleware/auth.js）若存在則啟用
// - /ask 支援 router 或 handler，缺時裝離線假回覆
// - /admin/api 受 ADMIN_ENABLE 控制
// - /healthz /readyz
// - ESM (__dirname) 與 Mongo 連線保護

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

// ── ESM __dirname ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── ENV ────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
const ADMIN_ENABLE = ["1", "true", "yes"].includes(
  String(process.env.ADMIN_ENABLE || "").toLowerCase()
);
const OPEN_REGISTER = ["1", "true", "yes"].includes(
  String(process.env.OPEN_REGISTER || "").toLowerCase()
);

// ── 預載 Model（避免 MissingSchemaError）────────────────────
try {
  await import("./models/User.js");
} catch (e) {
  console.warn(
    "[Server] models/User.js not found or failed to import (ok if not needed)",
    e?.message || e
  );
}

// ── App 與中介層（注意順序）────────────────────────────────
const app = express();
app.disable("x-powered-by");

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(
  morgan(
    ':method :url :status :res[content-length] - :response-time ms',
    { skip: (req) => req.path === "/healthz" || req.path === "/readyz" }
  )
);

// ── 健康檢查（永遠開）─────────────────────────────────────
app.get("/healthz", (_req, res) => {
  const db = mongoose.connection?.readyState === 1 ? "up" : "down";
  res.json({ ok: true, db, ts: Date.now() });
});
app.get("/readyz", (_req, res) => {
  if (MONGODB_URI && mongoose.connection?.readyState !== 1) {
    return res.status(503).json({ ok: false, db: "down" });
  }
  res.json({ ok: true });
});

// ── /auth 先掛（不經 Gate）────────────────────────────────
try {
  const authRoutes = (await import("./routes/auth.js"))?.default;
  if (authRoutes) {
    app.use("/auth", authRoutes);
  } else {
    console.warn("[Auth] routes/auth.js exists but no default export – skipped");
  }
} catch {
  console.log("[Auth] routes/auth.js not found – skipped");
}

// ── Gate（middleware/auth.js 存在才啟用）──────────────────
let gateLoaded = false;
try {
  const gateMod = await import("./middleware/auth.js");
  const gate = gateMod?.default || gateMod;
  if (typeof gate === "function") {
    app.use(gate);
    gateLoaded = true;
    console.log("[Gate] access middleware enabled");
  } else {
    console.log("[Gate] access middleware module is not a function – skip");
  }
} catch {
  console.log("[Gate] access middleware not found – continue without gating");
}

// ── /ask（支援 router 或 handler；缺則掛假回覆）────────────
try {
  const askMod = await import("./routes/ask.js");
  const askHandler = askMod?.askHandler || askMod?.default || askMod;
  if (typeof askHandler === "function" || askHandler?.stack) {
    // 你的 ask.js 若已定義 /ask 與 /ask/stream，此處掛在根也 OK
    app.use("/", askHandler);
    console.log("[Ask] route mounted");
  } else {
    app.post("/ask", (_req, res) =>
      res.json({ ok: true, used_model: "fake", answer: "【離線測試回覆】" })
    );
    console.warn("[Ask] export 非預期，已掛載假回覆（僅測試）");
  }
} catch {
  app.post("/ask", (_req, res) =>
    res.json({ ok: true, used_model: "fake", answer: "【離線測試回覆】" })
  );
  console.warn("[Ask] routes/ask.js not found – mounted fake /ask for test");
}

// ── 靜態頁：/admin 與根目錄 / ────────────────────────────
const ADMIN_DIR = path.join(__dirname, "public", "admin");
if (fs.existsSync(ADMIN_DIR)) {
  app.use(
    "/admin",
    express.static(ADMIN_DIR, { index: "index.html", extensions: ["html"] })
  );
  console.log("[Admin-Static] serving", ADMIN_DIR);
} else {
  console.log("[Admin-Static] public/admin/ not found – skip");
}

const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  app.use("/", express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"] }));
  console.log("[Public-Static] serving", PUBLIC_DIR);
} else {
  console.log("[Public-Static] public/index.html not found – root will 404");
}

// ── （可選）/admin API：建議掛 /admin/api 以免與靜態頁衝突 ─────
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

// ── 404（最後）────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

// ── 啟動 Mongo 與 Server ──────────────────────────────────
async function connectDB() {
  if (!MONGODB_URI) {
    console.log("[DB] no MONGODB_URI provided – skip");
    return;
  }
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
  if (!OPEN_REGISTER) {
    console.log("[Server] OPEN_REGISTER=0 (public /auth/register closed)");
  } else {
    console.log("[Server] OPEN_REGISTER=1 (public /auth/register open)");
  }
});

export default app;
