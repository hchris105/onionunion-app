// routes/claim.js  (ESM)
import { Router } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

const router = Router();

/**
 * POST /auth/preorder-lookup
 * 查詢白名單帳號是否存在、是否已認領
 * body: { handle: string }
 */
router.post("/preorder-lookup", async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle) return res.status(400).json({ ok:false, error:"missing_handle" });
    const h = String(handle).toLowerCase();
    const u = await User.findOne({ handle: h }).lean();
    if (!u) return res.json({ ok:true, exists:false });
    return res.json({
      ok: true,
      exists: true,
      claimed: !!u.password_hash,
      status: u.status || "preorder",
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"lookup_failed", detail:String(e?.message||e) });
  }
});

/**
 * POST /auth/claim
 * 自助認領：用 handle + wechat 匹配，設定密碼並啟用
 * body: { handle, wechat, new_password }
 */
router.post("/claim", async (req, res) => {
  try {
    const { handle, wechat, new_password } = req.body || {};
    if (!handle || !wechat || !new_password) {
      return res.status(400).json({ ok:false, error:"missing_fields" });
    }
    const h = String(handle).toLowerCase();
    const w = String(wechat).trim();

    const user = await User.findOne({ handle: h });
    if (!user) return res.status(404).json({ ok:false, error:"not_found" });
    if (user.password_hash) {
      return res.status(409).json({ ok:false, error:"already_claimed" });
    }
    if (!user.wechat_id) {
      return res.status(422).json({ ok:false, error:"no_wechat_on_file", message:"白名單缺少微信號，請人工協助" });
    }
    if (String(user.wechat_id) !== w) {
      return res.status(401).json({ ok:false, error:"wechat_mismatch" });
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
    user.password_hash = await bcrypt.hash(String(new_password), rounds);
    user.must_reset_password = false;
    user.status = "active";
    user.roles = user.roles?.length ? user.roles : ["member"]; // 或改 ["visitor"]
    user.registered_at = new Date();
    await user.save();

    return res.json({ ok:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"claim_failed", detail:String(e?.message||e) });
  }
});

export default router;
