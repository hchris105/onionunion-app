// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// —— 解析器（避免 req.body 被吃掉）——
app.use(express.json({ limit: "1mb", strict: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: "text/*", limit: "1mb" }));

// —— 健康檢查 —— 
app.get("/healthz", (req, res) => {
  res.json({ ok: true, up: true, ts: Date.now() });
});

// —— 靜態檔（前端頁面在 public/）——
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0 }));

// —— 核心 ask 路由 —— 
import askRouter from "./routes/ask.js";
app.use("/ask", askRouter);

// —— 會員/DB 改走「條件載入」（預設關閉，避免干擾核心）——
const DISABLE_ADMIN = process.env.DISABLE_ADMIN === "1";
const ENABLE_DB = process.env.ENABLE_DB === "1";

if (ENABLE_DB || !DISABLE_ADMIN) {
  try {
    const { default: connectDB } = await import("./services/db.js");
    if (connectDB) await connectDB();
  } catch {
    console.warn("[DB] skipped (services/db.js not present)");
  }
}
if (!DISABLE_ADMIN) {
  try {
    const { default: adminApi } = await import("./routes/admin.api.js");
    app.use("/admin/api", adminApi);
    app.use("/admin", express.static(path.join(__dirname, "public/admin")));
  } catch {
    console.warn("[Admin] skipped (admin api/ui not present)");
  }
}

// —— 啟動 —— 
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Server] OnionUnion API listening on http://127.0.0.1:${PORT}`);
  console.log(`[Server] OPEN_REGISTER=${process.env.OPEN_REGISTER ?? 0} (public /auth/register ${process.env.OPEN_REGISTER === "1" ? "open" : "closed"})`);
});

export default app;
