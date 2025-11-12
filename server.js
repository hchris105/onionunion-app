// server.js  — OnionUnion minimal server (ESM)
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// --- 基本路徑工具（避免相對路徑找不到檔） ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const r = (...p) => path.join(__dirname, ...p);

// --- 環境變數 ---
import dotenv from "dotenv";
dotenv.config();
const PORT = process.env.PORT || 3000;
const OPEN_REGISTER = String(process.env.OPEN_REGISTER || "0");

// --- DB 連線 ---
import "./services/db.js";

// --- App 基礎 ---
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// --- 靜態檔案 ---
app.use(express.static(r("public")));

// --- Healthz ---
app.get("/healthz", (req, res) => {
  res.json({ ok: true, up: true, ts: Date.now() });
});

// --- 路由載入（用絕對路徑 + 存在才載，避免「找不到」） ---
async function tryMountAuth() {
  const p = r("routes", "auth.js");
  if (fs.existsSync(p)) {
    const mod = await import(pathToFileURL(p).href).catch(() => import("file://" + p));
    app.use("/auth", mod.default);
    console.log("[Auth] mounted:", p);
  } else {
    console.log("[Auth] skipped (routes/auth.js not present)");
  }
}

async function tryMountAsk() {
  const p = r("routes", "ask.js");
  if (fs.existsSync(p)) {
    const mod = await import(pathToFileURL(p).href).catch(() => import("file://" + p));
    app.use("/ask", mod.default);
    console.log("[Ask] mounted:", p);
  } else {
    console.log("[Ask] skipped (routes/ask.js not present)");
  }
}

async function tryMountAdminApi() {
  const p = r("routes", "admin.api.js");
  if (fs.existsSync(p)) {
    const mod = await import(pathToFileURL(p).href).catch(() => import("file://" + p));
    app.use("/admin", mod.default);
    console.log("[AdminAPI] mounted:", p);
  } else {
    console.log("[AdminAPI] skipped (routes/admin.api.js not present)");
  }
}

// node:url 的 fileURL 轉換（上面用到）
import { pathToFileURL } from "node:url";

// --- 啟動 ---
const start = async () => {
  // 統一輸出 OPEN_REGISTER 狀態（你之前有）
  console.log(
    "[Server] OPEN_REGISTER=" +
      OPEN_REGISTER +
      " (public /auth/register " +
      (OPEN_REGISTER === "1" ? "open" : "closed") +
      ")"
  );

  await tryMountAuth();
  await tryMountAsk();
  await tryMountAdminApi();

  const srv = app.listen(PORT, "127.0.0.1", () => {
    console.log(`[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`);
  });

  // 平滑結束
  process.on("SIGTERM", () => srv.close(() => process.exit(0)));
  process.on("SIGINT", () => srv.close(() => process.exit(0)));
};

start();
