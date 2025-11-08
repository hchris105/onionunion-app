// routes/admin.js - OnionUnion Admin API (ESM)
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

const router = express.Router();

// --- Admin Token Guard ---
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
router.use((req, res, next) => {
  const t = req.get("X-Admin-Token") || req.query.admin_token || "";
  if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

// --- Helpers ---
const pick = (obj, keys) => {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
};

// 1) 統計
router.get("/stats", async (_req, res) => {
  const total = await User.countDocuments({});
  const preorder = await User.countDocuments({ status: "preorder" });
  const active = await User.countDocuments({ status: "active" });
  res.json({ ok: true, total, preorder, active });
});

// 2) 列表（支援關鍵字、狀態、分頁）
router.get("/preorders", async (req, res) => {
  const {
    q = "",
    status = "preorder",
    limit = 50,
    skip = 0,
  } = req.query;

  const query = {};
  if (status) query.status = status;
  if (q) {
    query.$or = [
      { handle: { $regex: q, $options: "i" } },
      { wechat_id: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
    ];
  }

  const docs = await User.find(query, {
    handle: 1,
    wechat_id: 1,
    status: 1,
    email: 1,
    createdAt: 1,
    updatedAt: 1,
  })
    .skip(Number(skip))
    .limit(Math.min(Number(limit), 200))
    .sort({ _id: -1 })
    .lean();

  const total = await User.countDocuments(query);
  res.json({ ok: true, total, items: docs });
});

// 3) 新增單筆預約
router.post("/preorders", async (req, res) => {
  let { handle, wechat_id, email } = req.body || {};
  if (!handle || typeof handle !== "string") {
    return res.json({ ok: false, error: "handle_required" });
  }
  handle = handle.trim().toLowerCase();
  if (wechat_id) wechat_id = String(wechat_id).trim();
  if (email) email = String(email).trim();

  // 僅當不存在時插入，避免覆蓋已認領帳號
  const doc = {
    handle,
    wechat_id: wechat_id || null,
    email: email || null,
    status: "preorder",
    password_hash: null,
    must_reset_password: false,
    roles: ["member"],
  };

  await User.updateOne({ handle }, { $setOnInsert: doc }, { upsert: true });
  const saved = await User.findOne({ handle }, { handle: 1, wechat_id: 1, status: 1 }).lean();
  res.json({ ok: true, user: saved });
});

// 4) 批量新增（純文字 CSV：handle,wechat,email）
router.post("/preorders/bulk", async (req, res) => {
  const { text = "" } = req.body || {};
  if (!text) return res.json({ ok: false, error: "text_required" });

  const lines = String(text).split(/\r?\n/).filter(Boolean);
  let imported = 0, skipped = 0;

  for (const line of lines) {
    const [h, w, e] = line.split(",").map((s) => (s ?? "").trim());
    if (!h) { skipped++; continue; }
    const handle = h.toLowerCase();
    const wechat_id = w || null;
    const email = e || null;

    const doc = {
      handle,
      wechat_id,
      email,
      status: "preorder",
      password_hash: null,
      must_reset_password: false,
      roles: ["member"],
    };
    await User.updateOne({ handle }, { $setOnInsert: doc }, { upsert: true });
    imported++;
  }

  res.json({ ok: true, imported, skipped });
});

// 5) 模擬啟用（等同用戶認領成功）
router.post("/user/activate", async (req, res) => {
  const { handle } = req.body || {};
  if (!handle) return res.json({ ok: false, error: "handle_required" });

  const u = await User.findOneAndUpdate(
    { handle: handle.toLowerCase() },
    { $set: { status: "active" } },
    { new: true }
  ).lean();

  if (!u) return res.json({ ok: false, error: "not_found" });
  res.json({ ok: true, user: pick(u, ["handle", "status", "wechat_id"]) });
});

// 6) 重設密碼（測試用）
router.post("/user/reset-password", async (req, res) => {
  const { handle, new_password } = req.body || {};
  if (!handle || !new_password)
    return res.json({ ok: false, error: "handle_and_password_required" });

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const password_hash = await bcrypt.hash(String(new_password), rounds);

  const u = await User.findOneAndUpdate(
    { handle: handle.toLowerCase() },
    { $set: { password_hash, status: "active", must_reset_password: false } },
    { new: true }
  ).lean();

  if (!u) return res.json({ ok: false, error: "not_found" });
  res.json({ ok: true, user: pick(u, ["handle", "status"]) });
});

// 7) 刪除（誤匯入/測試資料清掉）
router.post("/user/delete", async (req, res) => {
  const { handle } = req.body || {};
  if (!handle) return res.json({ ok: false, error: "handle_required" });
  const r = await User.deleteOne({ handle: handle.toLowerCase() });
  res.json({ ok: true, deleted: r.deletedCount });
});

// 8) login-check（管理側快速檢查）
router.post("/debug/login-check", async (req, res) => {
  const { identifier } = req.body || {};
  if (!identifier) return res.json({ ok: false, error: "identifier_required" });

  const query = {
    $or: [
      { handle: identifier.toLowerCase() },
      { wechat_id: identifier },
      { email: identifier },
    ],
  };
  const user = await User.findOne(query, {
    handle: 1, wechat_id: 1, email: 1, status: 1, password_hash: 1,
  }).lean();

  if (!user) return res.json({ ok: false, error: "not_found" });
  res.json({ ok: true, user });
});

export default router;
