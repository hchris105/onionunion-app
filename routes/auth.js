// routes/auth.js — OnionUnion Auth (whitelist + claim + login)
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

// 若專案內沒有 gate，可刪除下行三個 import 並把對應程式碼註解
import { isOpen, openGate, closeGate } from "../lib/gate.js";

const router = express.Router();

const ADMIN_TOKEN   = process.env.ADMIN_TOKEN   || "";
const JWT_SECRET    = process.env.JWT_SECRET    || "dev_secret_change_me";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// -------- Helpers --------
function requireAdmin(req, res, next) {
  const t = req.get("X-Admin-Token") || "";
  if (!t || t !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

function normStr(v) {
  return String(v || "").trim();
}

function normLower(v) {
  return normStr(v).toLowerCase();
}

// -------- Admin APIs --------

// 單筆新增白名單（可從後台或小工具呼叫）
router.post("/admin/add-preorder", requireAdmin, async (req, res) => {
  try {
    const { handle, email, wechat, name } = req.body || {};
    const h = normLower(handle);
    if (!h) return res.status(400).json({ ok: false, error: "handle_required" });

    // email/wechat 選填
    const doc = {
      handle: h,
      status: "preorder",
      password_hash: null,
      must_reset_password: false,
      name: name || null,
    };
    if (email)  doc.email = normLower(email);
    if (wechat) doc.wechat_id = normStr(wechat);

    await User.updateOne(
      { handle: h },
      { $setOnInsert: { created_at: new Date() }, $set: doc },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[Admin.add-preorder] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// 開/關白名單註冊門（可選，專案若無 gate 可刪除）
router.post("/admin/preorder-register-open",  requireAdmin, (_req, res) => { openGate();  res.json({ ok: true, open: isOpen() }); });
router.post("/admin/preorder-register-close", requireAdmin, (_req, res) => { closeGate(); res.json({ ok: true, open: isOpen() }); });

// -------- Public APIs --------

// 白名單預檢：前端只送 handle，回傳是否存在與是否已認領
router.post("/preorder-lookup", async (req, res) => {
  try {
    const { handle } = req.body || {};
    const h = normLower(handle);
    if (!h) return res.status(400).json({ ok: false, error: "handle_required" });

    const u = await User.findOne({ handle: h }, { _id: 1, status: 1 }).lean();
    if (!u) return res.json({ ok: true, exists: false });

    return res.json({ ok: true, exists: true, claimed: u.status === "active" });
  } catch (err) {
    console.error("[preorder-lookup] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// 認領帳號（以微信號驗證 + 設定新密碼）
// body: { handle, wechat, new_password }
router.post("/claim", async (req, res) => {
  try {
    const { handle, wechat, new_password } = req.body || {};
    const h   = normLower(handle);
    const wx  = normStr(wechat);
    const pwd = normStr(new_password);

    if (!h || !wx || !pwd) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // 若你想限制在門開啟時才能認領，取消下行註解：
    // if (!isOpen()) return res.status(403).json({ ok: false, error: "register_closed" });

    const u = await User.findOne({ handle: h }).lean();
    if (!u) return res.json({ ok: false, error: "not_found" });

    if (u.status === "active") return res.json({ ok: true, already: true });

    // 需是白名單 + 需有對應微信號
    if (u.status !== "preorder") return res.json({ ok: false, error: "not_in_whitelist" });

    const bindWx = normStr(u.wechat_id || "");
    if (!bindWx || bindWx !== wx) {
      return res.json({ ok: false, error: "wechat_mismatch" });
    }

    const password_hash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
    await User.updateOne(
      { _id: u._id },
      {
        $set: {
          password_hash,
          status: "active",
          must_reset_password: false,
          registered_at: new Date(),
        },
      }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("[claim] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// 登入：同時支援 handle 或 email，僅允許 active 帳號
// body: { identifier | handle | email, password }
router.post("/login", async (req, res) => {
  try {
    let { identifier, handle, email, password } = req.body || {};
    if (!identifier && handle) identifier = handle;
    if (!identifier && email)  identifier = email;

    const id = normStr(identifier);
    const pwd = normStr(password);
    if (!id || !pwd) return res.status(400).json({ ok: false, error: "missing_fields" });

    const isEmail = id.includes("@");
    const query = isEmail ? { email: normLower(id) } : { handle: normLower(id) };

    const u = await User.findOne({ ...query, status: "active" }).lean();
    if (!u || !u.password_hash) return res.json({ ok: false, error: "not_found" });

    const ok = await bcrypt.compare(pwd, u.password_hash);
    if (!ok) return res.json({ ok: false, error: "bad_password" });

    const token = jwt.sign(
      { uid: String(u._id), handle: u.handle, roles: u.roles || [] },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({ ok: true, token, handle: u.handle });
  } catch (err) {
    console.error("[login] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// 除錯：查某 handle 的重要欄位
router.get("/_debug/:handle", async (req, res) => {
  try {
    const h = normLower(req.params.handle);
    const u = await User.findOne(
      { handle: h },
      { handle: 1, status: 1, wechat_id: 1, email: 1, password_hash: 1 }
    ).lean();
    if (!u) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, user: u });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
