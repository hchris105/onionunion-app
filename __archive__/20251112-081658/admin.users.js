// routes/admin.users.js — Admin Users API（穩定版 + 錯誤細節 + 嚴謹投影）ESM
import { Router } from "express";
import mongoose from "mongoose";

// 這裡直接取用已註冊的 User 模型（你的 User.js 在 server 啟動時已 import）
// 如未註冊，會 throw；我們在 catch 內回 detail 方便排錯
let UserModel = null;
try {
  UserModel = mongoose.model("User");
} catch (e) {
  // 如果專案是 export default User from '../User.js' 方式載入，也可改成下面這行：
  // const mod = await import("../User.js"); UserModel = mod?.default || mod?.User;
  throw e;
}

export default function buildUsersRouter() {
  const r = Router();

  // 參數清洗
  const toInt = (v, d) => {
    const n = Number.parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };

  // GET /admin/api/users
  // ?page=1&limit=20&q=keyword&status=preorder|active&role=member
  r.get("/", async (req, res) => {
    try {
      // 分頁與排序
      const page  = toInt(req.query.page, 1);
      const limit = Math.min(toInt(req.query.limit, 20), 200);
      const skip  = (page - 1) * limit;

      // 查詢條件
      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const role   = String(req.query.role || "").trim();

      const filter = {};
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        // 在 handle / nickname / email / wechat_id 上做 OR 搜尋
        filter.$or = [
          { handle:   rx },
          { nickname: rx },
          { email:    rx },
          { wechat_id:rx },
        ];
      }
      if (status) filter.status = status;
      if (role)   filter.roles  = role; // roles: ["member"] 時，用等號即可命中

      // 投影：只做「排除」型（select("-password_hash")），避免混用衝突
      const cursor = UserModel.find(filter)
        .sort({ createdAt: -1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .select("-password_hash -__v"); // <— 關鍵，避免 inclusion/exclusion 混用

      const [items, total] = await Promise.all([
        cursor.lean().exec(),
        UserModel.countDocuments(filter),
      ]);

      return res.json({
        ok: true,
        items,
        total,
        page,
        limit,
      });
    } catch (e) {
      // 帶出 detail，方便你用 curl 直接看到真正原因
      return res.status(500).json({
        ok: false,
        error: "LIST_FAILED",
        detail: String(e?.message || e),
      });
    }
  });

  // 刪除使用者（單筆）
  r.delete("/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ ok:false, error:"bad_id" });
      }
      const out = await UserModel.deleteOne({ _id: id });
      return res.json({ ok: true, deleted: out?.deletedCount || 0 });
    } catch (e) {
      return res.status(500).json({ ok:false, error:"DELETE_FAILED", detail:String(e?.message||e) });
    }
  });

  // 基礎更新（可改 nickname / email / wechat_id / status / roles）
  r.patch("/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ ok:false, error:"bad_id" });
      }

      // 僅允許安全欄位
      const allow = ["nickname","email","wechat_id","status","roles","memo"];
      const payload = {};
      for (const k of allow) {
        if (k in req.body) payload[k] = req.body[k];
      }
      payload.updatedAt = new Date();

      const out = await UserModel.findByIdAndUpdate(id, {$set: payload}, { new:true })
        .select("-password_hash -__v")
        .lean()
        .exec();

      if (!out) return res.status(404).json({ ok:false, error:"not_found" });
      return res.json({ ok:true, item: out });
    } catch (e) {
      return res.status(500).json({ ok:false, error:"PATCH_FAILED", detail:String(e?.message||e) });
    }
  });

  return r;
}
