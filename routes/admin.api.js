// routes/admin.api.js
import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";

const router = express.Router();

// --- 簡單的 Admin Gate：Basic Auth + X-Admin-Token ---
function adminGate(req, res, next) {
  try {
    const hdr = String(req.headers.authorization || "");
    const xTok = String(req.headers["x-admin-token"] || "");

    const needUser = process.env.ADMIN_USER || "";
    const needPass = process.env.ADMIN_PASS || "";
    const needToken = process.env.ADMIN_TOKEN || "";

    if (!hdr.startsWith("Basic ")) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    const b64 = hdr.slice(6);
    const [u, p] = Buffer.from(b64, "base64").toString("utf8").split(":");
    if (u !== needUser || p !== needPass) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    if (needToken && xTok !== needToken) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}

router.use(adminGate);

// 工具：搜尋條件
function buildSearchQuery(q) {
  if (!q) return {};
  const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return {
    $or: [{ handle: rx }, { email: rx }, { wechat_id: rx }, { nickname: rx }],
  };
}

// GET /admin/api/users
// 支援 ?q=keyword  ?status=active|preorder  ?role=member  ?page=1&limit=20
router.get("/users", async (req, res) => {
  try {
    const {
      q,
      status,
      role,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const find = { ...buildSearchQuery(q) };
    if (status) find.status = status;
    if (role) find.roles = role;

    const pageN = Math.max(1, parseInt(page, 10) || 1);
    const limN = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const cursor = User.find(find)
      .select([
        "_id",
        "handle",
        "nickname",
        "email",
        "wechat_id",
        "status",
        "roles",
        "classState",
        "counters",
        "must_reset_password",
        "memo",
        "tags",
        "registered_at",
        "last_login_at",
        "role_ticket_code",
        "createdAt",
        "updatedAt",
      ])
      .sort(sort)
      .skip((pageN - 1) * limN)
      .limit(limN)
      .lean();

    const [items, total] = await Promise.all([cursor, User.countDocuments(find)]);

    return res.json({
      ok: true,
      items,
      total,
      page: pageN,
      limit: limN,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      detail: String(e.message || e),
    });
  }
});

// GET /admin/api/users/:id  (給 admin.js openEditor 用)
router.get("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    const doc = await User.findById(id)
      .select([
        "_id",
        "handle",
        "nickname",
        "email",
        "wechat_id",
        "status",
        "roles",
        "classState",
        "counters",
        "must_reset_password",
        "memo",
        "tags",
        "registered_at",
        "last_login_at",
        "role_ticket_code",
        "createdAt",
        "updatedAt",
      ])
      .lean();

    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", detail: String(e.message || e) });
  }
});

// PATCH /admin/api/users/:id  (後台編修)
router.patch("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    // 允許修改的欄位白名單
    const allow = [
      "nickname",
      "email",
      "wechat_id",
      "status",
      "roles",
      "must_reset_password",
      "memo",
      "tags",
      "classState",
      "counters",
      "role_ticket_code",
    ];

    const patch = {};
    for (const k of allow) {
      if (k in req.body) patch[k] = req.body[k];
    }

    const updated = await User.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
      projection: {
        // 明確選出，仍不包含 password_hash
        handle: 1,
        nickname: 1,
        email: 1,
        wechat_id: 1,
        status: 1,
        roles: 1,
        classState: 1,
        counters: 1,
        must_reset_password: 1,
        memo: 1,
        tags: 1,
        registered_at: 1,
        last_login_at: 1,
        role_ticket_code: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    }).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "server_error", detail: String(e.message || e) });
  }
});

export default router;
