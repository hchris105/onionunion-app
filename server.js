// server.js — OnionUnion 穩定版（含 Admin BasicAuth + Token + /admin 專屬 CSP）
// 依賴：express, dotenv, cors, helmet, compression, morgan, mongoose, path, fs
// 注意：package.json 需包含 { "type": "module" }

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
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";

const OPEN_REGISTER = ["1", "true", "yes"].includes(
  String(process.env.OPEN_REGISTER || "").toLowerCase()
);

// Admin 後台開關與憑證
const DISABLE_ADMIN = ["1", "true", "yes"].includes(
  String(process.env.DISABLE_ADMIN || "").toLowerCase()
);
const ADMIN_ENABLE = ["1", "true", "yes"].includes(
  String(process.env.ADMIN_ENABLE || "").toLowerCase()
);
const ADMIN_USER = String(process.env.ADMIN_USER || "");
const ADMIN_PASS = String(process.env.ADMIN_PASS || "");
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "");

// ---- 預載 Model（避免 MissingSchemaError）----
try {
  await import("./models/User.js");
} catch (e) {
  console.warn(
    "[Server] models/User.js not found or failed to import (ok if not needed)",
    e?.message || e
  );
}

// ---- 建立 App（注意順序！）----
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// 全域安全/壓縮/日誌/跨域/解析
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    // 不全域開 CSP；/admin 會另外設
    contentSecurityPolicy: false,
  })
);
app.use(compression());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(morgan("combined"));

// ---- 健康檢查（永遠開）----
app.get("/healthz", (_req, res) => {
  const db = mongoose.connection?.readyState === 1 ? "up" : "down";
  res.json({ ok: true, db, ts: Date.now() });
});

// ---- /auth：登入/註冊（你已完成的 routes/auth.js）----
try {
  const authRoutes = (await import("./routes/auth.js"))?.default;
  if (authRoutes) app.use("/auth", authRoutes);
  else console.warn("[Auth] routes/auth.js export not found – skipped");
} catch (e) {
  console.warn("[Auth] routes/auth.js not found – skipped");
}

// ---- /auth 認領 claim（routes/claim.js）----
try {
  const claimRoutes = (await import("./routes/claim.js"))?.default;
  if (claimRoutes) {
    app.use("/auth", claimRoutes);
    console.log("[Claim] mounted /auth/preorder-lookup & /auth/claim");
  } else {
    console.warn("[Claim] routes/claim.js export not found – skipped");
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
      res.json({
        ok: true,
        used_model: "fake",
        answer: "【離線測試回覆】ask handler not found",
      })
    );
    console.warn("[Ask] ask.js export 非預期，已掛載假回覆（僅測試）");
  }
} catch {
  app.post("/ask", (_req, res) =>
    res.json({
      ok: true,
      used_model: "fake",
      answer: "【離線測試回覆】routes/ask.js not found",
    })
  );
  console.warn("[Ask] routes/ask.js not found – mounted fake /ask for test");
}

/* --------------------- Admin 保護層（Basic + Token） --------------------- */

// 401 helper
function unauthorized(res, realm = "OnionUnion Admin") {
  res.set("WWW-Authenticate", `Basic realm="${realm}", charset="UTF-8"`);
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

// BasicAuth 驗證（帳號密碼）
function adminBasicAuth(req, res, next) {
  if (!ADMIN_ENABLE || !ADMIN_USER || !ADMIN_PASS) {
    return res
      .status(403)
      .json({ ok: false, error: "admin_disabled_or_no_creds" });
  }
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return unauthorized(res);

  const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = raw.indexOf(":");
  const user = raw.slice(0, sep);
  const pass = raw.slice(sep + 1);

  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  return unauthorized(res);
}

// Admin-Token 驗證（API）
function requireAdminToken(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    req.headers["x-admin_key"] ||
    req.headers["x-admin-token"];
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, error: "invalid_admin_token" });
  }
  return next();
}

/* --------------------- /admin 靜態頁（僅 /admin 放寬 CSP） --------------------- */

const ADMIN_DIR = path.join(__dirname, "public", "admin");
if (!DISABLE_ADMIN && fs.existsSync(ADMIN_DIR)) {
  const adminRouter = express.Router();

  // 先做 BasicAuth
  adminRouter.use(adminBasicAuth);

  // 只在 /admin 設置 CSP（允許 inline；你目前 admin.html 有 inline <script>）
  adminRouter.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
      },
    })
  );

  // 不快取後台頁面
  adminRouter.use((_, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    next();
  });

  // 提供靜態檔
  adminRouter.use(express.static(ADMIN_DIR, { index: "index.html" }));

  app.use("/admin", adminRouter);
  console.log("[Admin-Static] serving", ADMIN_DIR);
} else {
  console.log("[Admin-Static] skipped (DISABLE_ADMIN=1 或 public/admin/ 不存在)");
}

/* --------------------- /admin/api（需 Basic + Token） --------------------- */

if (!DISABLE_ADMIN && ADMIN_ENABLE) {
  try {
    const adminRoutes = (await import("./routes/admin.js"))?.default;
    if (adminRoutes) {
      const apiRouter = express.Router();
      apiRouter.use(adminBasicAuth);
      apiRouter.use(requireAdminToken);
      apiRouter.use(adminRoutes);
      app.use("/admin/api", apiRouter);
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

/* --------------------- 靜態根目錄 --------------------- */

const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  app.use("/", express.static(PUBLIC_DIR, { index: "index.html" }));
  console.log("[Public-Static] serving", PUBLIC_DIR);
} else {
  console.log("[Public-Static] public/index.html not found – root will 404");
}

/* --------------------- 404（最後） --------------------- */

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

/* --------------------- 啟動 Mongo 與 Server --------------------- */

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: "onionunion" });
    console.log("[DB] connected");
  } catch (e) {
    console.error("[DB] connect error:", e?.message || e);
  }
}
await connectDB();

app.listen(PORT, () => {
  console.log(`[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`);
  console.log(`[Server] Gate ${gateLoaded ? "ENABLED" : "DISABLED"}`);
  if (!OPEN_REGISTER) {
    console.log("[Server] OPEN_REGISTER=0 (public /auth/register closed)");
  }
});

export default app;
