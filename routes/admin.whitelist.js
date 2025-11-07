// routes/admin.whitelist.js
import express from 'express';
import User from '../models/User.js';

const router = express.Router();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function adminGuard(req, res, next) {
  if (!ADMIN_TOKEN || req.get('X-Admin-Token') !== ADMIN_TOKEN) {
    return res.json({ ok: false, error: 'admin_auth' });
  }
  next();
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function normalizeHandles(input) {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (let raw of lines) {
    if (!raw) continue;
    let s = raw.replace(/\u3000/g, ' ').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// 批次新增／更新白名單
router.post('/whitelist/add', adminGuard, async (req, res) => {
  const list = normalizeHandles(req.body?.handles);
  if (!list.length) return res.json({ ok: true, created: 0, updated: 0 });
  let created = 0, updated = 0, errors = [];
  for (const h of list) {
    try {
      const r = await User.updateOne(
        { handle: new RegExp(`^${escapeRx(h)}$`, 'i') },
        { $setOnInsert: { handle: h, preorder: true }, $unset: { password_hash: '' } },
        { upsert: true }
      );
      if (r.upsertedCount) created++; else updated++;
    } catch (e) {
      errors.push({ handle: h, error: e.message });
    }
  }
  res.json({ ok: true, created, updated, errors });
});

// 檢查單一帳號是否在白名單
router.get('/whitelist/check', adminGuard, async (req, res) => {
  const h = (req.query.handle || '').trim();
  if (!h) return res.json({ ok: false, error: 'missing_handle' });
  const u = await User.findOne({ handle: new RegExp(`^${escapeRx(h)}$`, 'i') })
                      .select('handle preorder email role');
  res.json({ ok: true, found: !!u, user: u });
});

// 從白名單移除（只是把 preorder 取消，不刪帳號）
router.delete('/whitelist/:handle', adminGuard, async (req, res) => {
  const h = (req.params.handle || '').trim();
  const r = await User.updateOne(
    { handle: new RegExp(`^${escapeRx(h)}$`, 'i') },
    { $unset: { preorder: '' } }
  );
  res.json({ ok: true, modified: r.modifiedCount });
});

// 將某帳號升級為 admin 或降為 member
router.post('/users/make-admin', adminGuard, async (req, res) => {
  const { handle, make = true } = req.body || {};
  if (!handle) return res.json({ ok: false, error: 'missing_handle' });
  const r = await User.updateOne(
    { handle: new RegExp(`^${escapeRx(handle)}$`, 'i') },
    { $set: { role: make ? 'admin' : 'member' } }
  );
  res.json({ ok: true, modified: r.modifiedCount });
});

// 列出目前的管理員
router.get('/users/admins', adminGuard, async (_req, res) => {
  const list = await User.find({ role: 'admin' }).select('handle email');
  res.json({ ok: true, admins: list });
});

export default router;
