// routes/auth.js  — OnionUnion Auth Routes (ESM)
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const DEBUG = ["1", "true", "yes"].includes(String(process.env.DEBUG_AUTH || "").toLowerCase());
const router = express.Router();

// ---- User model（若外部已定義則重用）----
let User;
try {
  User = mongoose.model("User");
} catch {
  const userSchema = new mongoose.Schema(
    {
      handle: { type: String, index: true },           // 洋蔥聯盟帳號（必填）
      email:  { type: String, index: true, sparse: true },
      wechat_id: { type: String, index: true, sparse: true },
      status: { type: String, default: "preorder", index: true }, // preorder | active | disabled
      password_hash: { type: String },
      roles: { type: [String], default: [] },
      meta: { type: Object, default: {} },
    },
    { collection: "users", timestamps: true }
  );
  // 僅 handle 做唯一性，email/wechat 允許缺省（sparse）
  userSchema.index({ handle: 1 }, { unique: true });
  userSchema.index({ email: 1 }, { unique: true, sparse: true });
  userSchema.index({ wechat_id: 1 }, { unique: true, sparse: true });
  User = mongoose.model("User", userSchema);
}

// 工具：產生不分大小寫、整字匹配的正則
const iEq = (v) => ({ $regex: new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });

// 工具：從 identifier（handle / email / wechat）組合查詢
const buildIdentifierQuery = (identifier) => {
  const ident = String(identifier || "").trim();
  if (!ident) return null;

  const ors = [
    { handle: iEq(ident) },
    { wechat_id: iEq(ident) },
  ];
  // 簡單判別 email
  if (ident.includes("@")) ors.push({ email: iEq(ident) });

  return { $or: ors };
};

// ---------- 1) 查預約/使用狀態 ----------
router.post("/preorder-lookup", async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle) return res.status(400).json({ ok: false, error: "missing_handle" });

    const user = await User.findOne({ handle: iEq(handle) })
      .select({ handle: 1, status: 1, password_hash: 1 })
      .lean();

    if (!user) return res.json({ ok: true, exists: false });

    const claimed = Boolean(user.password_hash);
    return res.json({
      ok: true,
      exists: true,
      claimed,
      status: user.status || "preorder",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
});

// ---------- 2) 認領帳號（預約 → 設定密碼 / 綁定微信） ----------
router.post("/claim", async (req, res) => {
  try {
    const { handle, wechat, new_password } = req.body || {};
    if (!handle || !new_password) {
      return res.status(400).json({ ok: false, error: "missing_params" });
    }

    const user = await User.findOne({ handle: iEq(handle) }).lean();
    if (!user) return res.status(404).json({ ok: false, error: "not_found" });

    // 允許兩種情況進行認領：
    // A) 預約帳號（preorder）
    // B) 已 active 但尚未設密碼（password_hash 不存在）
    if (!["preorder", "active"].includes(user.status || "preorder")) {
      return res.status(400).json({ ok: false, error: "invalid_status" });
    }
    if (user.status === "active" && user.password_hash) {
      return res.status(409).json({ ok: false, error: "already_claimed" });
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const password_hash = await bcrypt.hash(String(new_password), rounds);

    const set = { password_hash, status: "active" };
    if (wechat) set.wechat_id = String(wechat).trim();

    const updated = await User.findOneAndUpdate(
      { handle: iEq(handle) },
      { $set: set },
      { new: true }
    ).select({ handle: 1, status: 1, wechat_id: 1 }).lean();

    if (!updated) return res.status(500).json({ ok: false, error: "update_failed" });

    return res.json({ ok: true, handle: updated.handle, status: updated.status, wechat_id: updated.wechat_id || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
});

// ---------- 3) 登入 ----------
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ ok: false, error: "missing_params" });

    const query = buildIdentifierQuery(identifier);
    if (!query) return res.status(400).json({ ok: false, error: "invalid_identifier" });

    const user = await User.findOne(query).select({ handle: 1, status: 1, password_hash: 1, wechat_id: 1 }).lean();

    if (DEBUG) console.log("[Auth] login query=", JSON.stringify(query), "found=", !!user);

    if (!user) return res.status(404).json({ ok: false, error: "not_found" });
    if (user.status === "disabled") return res.status(403).json({ ok: false, error: "disabled" });
    if (!user.password_hash) return res.status(409).json({ ok: false, error: "not_claimed" });

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "bad_password" });

    return res.json({ ok: true, handle: user.handle, status: user.status, wechat_id: user.wechat_id || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
});

// ---------- 4) 調試：直接看資料 ----------
router.get("/_debug/:identifier", async (req, res) => {
  try {
    if (!DEBUG) return res.status(404).json({ ok: false, error: "debug_off" });

    const { identifier } = req.params || {};
    const query = buildIdentifierQuery(identifier);
    const user = query
      ? await User.findOne(query).select({ handle: 1, status: 1, password_hash: 1, wechat_id: 1 }).lean()
      : null;

    return res.json({ ok: Boolean(user), query, user: user || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
});

// ---------- 5) 調試：login 查詢條件回傳 ----------
router.post("/_debug/login-check", async (req, res) => {
  try {
    if (!DEBUG) return res.status(404).json({ ok: false, error: "debug_off" });

    const { identifier } = req.body || {};
    const query = buildIdentifierQuery(identifier);
    if (!query) return res.json({ ok: false, error: "invalid_identifier" });

    const user = await User.findOne(query).select({ handle: 1, status: 1, password_hash: 1, wechat_id: 1 }).lean();
    return res.json({ ok: true, query, found: Boolean(user), user: user || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e?.message || e) });
  }
});

export default router;
