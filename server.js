// backend/server.js — OnionUnion minimal server (ESM, with debug logs)
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import db from "./services/db.js"; // Mongo + 索引

// ---- 路徑工具 ---------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const r = (...p) => path.join(__dirname, ...p);

// ---- 環境變數 ---------------------------------------------------------------
dotenv.config();
const PORT = process.env.PORT || 3000;
const OPEN_REGISTER = String(process.env.OPEN_REGISTER || "0");

// 從 services/db.js 拿 initDB
const { initDB } = db;

// ---- 建立 App ---------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- 靜態資源：backend/public + frontend/dist -------------------------------
const PUBLIC_DIR = r("public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  console.log("[Static] backend public mounted:", PUBLIC_DIR);
}

// 如果你有前端 build（例如 React / Vite），預設放 ../frontend/dist
const FRONTEND_BUILD_DIR =
  process.env.FRONTEND_BUILD_DIR ||
  path.join(__dirname, "..", "frontend", "dist");

if (fs.existsSync(FRONTEND_BUILD_DIR)) {
  app.use(express.static(FRONTEND_BUILD_DIR));
  console.log("[Static] frontend build mounted:", FRONTEND_BUILD_DIR);

  // 根路由交給前端
  app.get("/", (req, res) => {
    res.sendFile(path.join(FRONTEND_BUILD_DIR, "index.html"));
  });
}

// ---- 健康檢查 / ping --------------------------------------------------------
app.get("/healthz", (req, res) =>
  res.json({ ok: true, up: true, ts: Date.now() })
);

app.get("/ping", (req, res) =>
  res.json({ ok: true, msg: "pong", ts: Date.now() })
);

// ---- 動態載入路由 -----------------------------------------------------------
async function mountIfExists(mountPath, relFile) {
  const abs = r(...relFile.split("/"));
  if (!fs.existsSync(abs)) {
    console.warn(`[Mount] SKIP ${mountPath} (missing ${relFile})`);
    return;
  }
  try {
    const mod = await import(pathToFileURL(abs).href);
    const router = mod.default ?? mod.router ?? mod;
    app.use(mountPath, router);
    console.log(`[Mount] OK   ${mountPath} <- ${relFile}`);
  } catch (err) {
    console.error(
      `[Mount] FAIL ${mountPath} <- ${relFile}:`,
      err?.message || err
    );
  }
}

// ---- 啟動邏輯 ---------------------------------------------------------------
async function start() {
  console.log(
    "[Server] OPEN_REGISTER=" +
      OPEN_REGISTER +
      " (public /auth/register " +
      (OPEN_REGISTER === "1" ? "open" : "closed") +
      ")"
  );

  // 先連 MongoDB
  try {
    await initDB();
    console.log("[Server] MongoDB connected");
  } catch (err) {
    console.error("[Server] Failed to connect MongoDB:", err?.message || err);
    // 連不到 DB 就不要硬撐，直接退出，讓你一眼看到錯
    process.exit(1);
  }

  // 掛上各路由（都在 backend/routes 下）
  await mountIfExists("/auth", "routes/auth.js");
  await mountIfExists("/ask", "routes/ask.js");
  await mountIfExists("/admin", "routes/admin.api.js");

  // 404 統一處理，避免什麼都不回
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "not_found",
      path: req.path,
    });
  });

  const srv = app.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`
    );
  });

  process.on("SIGTERM", () => srv.close(() => process.exit(0)));
  process.on("SIGINT", () => srv.close(() => process.exit(0)));
}

// 確保啟動錯誤會被印出來
start().catch((err) => {
  console.error("[Server] FATAL start error:", err?.message || err);
  process.exit(1);
});
