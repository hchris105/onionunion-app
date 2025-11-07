// routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// ── 設定 ───────────────────────────────────────────────────────────────
const router = express.Router();
const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'dev_secret_change_me';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';     // 只有本機運維開關在用

// 允許期間(公測用)：若 OPEN_REGISTER=true，直接放行（非白名單也能註冊）
// 預約期(預設)：OPEN_REGISTER!=true，僅限「白名單 + 尚未設定密碼」能註冊
const isOpenRegister = () => String(process.env.OPEN_REGISTER) === 'true';

// 工具：標準化 handle（保留原大小寫給展示，查詢做不分大小寫）
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findByHandle = async (h) =>
  User.findOne({ handle: new RegExp(`^${escapeRx(h)}$`, 'i') });

const issueToken = (u) =>
  jwt.sign(
    { uid: String(u._id), h: u.handle, role: u.role || 'visitor' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

// ── 健康檢查 & 除錯 ────────────────────────────────────────────────────
router.get('/healthz', async (_req, res) => {
  res.json({ ok: true, db: 'up', ts: Date.now() });
});

router.get('/_debug/:handle', async (req, res) => {
  const u = await findByHandle(req.params.handle || '');
  if (!u) return res.json({ ok: true, user: null });
  res.json({
    ok: true,
    user: {
      _id: u._id,
      handle: u.handle,
      preorder: !!u.preorder,
      has_password_hash: !!u.password_hash,
      email: u.email || null,
      role: u.role || 'visitor',
    },
  });
});

// ── 管理用：開/關預約註冊（需要 X-Admin-Token）────────────────────────
router.post('/preorder-register-open', (req, res) => {
  if (!ADMIN_TOKEN || req.get('X-Admin-Token') !== ADMIN_TOKEN) {
    return res.json({ ok: false, error: 'admin_auth' });
  }
  process.env.OPEN_REGISTER = 'true';
  res.json({ ok: true, preorder_open: true });
});

router.post('/preorder-register-close', (req, res) => {
  if (!ADMIN_TOKEN || req.get('X-Admin-Token') !== ADMIN_TOKEN) {
    return res.json({ ok: false, error: 'admin_auth' });
  }
  process.env.OPEN_REGISTER = 'false';
  res.json({ ok: true, preorder_open: false });
});

// ── 管理用：把帳號加到白名單（預約名單），並清掉既有 password_hash ────────
router.post('/admin/add-preorder', async (req, res) => {
  if (!ADMIN_TOKEN || req.get('X-Admin-Token') !== ADMIN_TOKEN) {
    return res.json({ ok: false, error: 'admin_auth' });
  }
  let { handles = [] } = req.body || {};
  if (typeof handles === 'string') {
    handles = handles.split(/\r?\n/);
  }
  const cleaned = [];
  const seen = new Set();
  for (let raw of handles) {
    if (!raw) continue;
    const s = String(raw).replace(/\u3000/g, ' ').trim(); // 全形空白→半形、去頭尾
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(s);
  }
  let created = 0, updated = 0;
  for (const h of cleaned) {
    const r = await User.updateOne(
      { handle: new RegExp(`^${escapeRx(h)}$`, 'i') },
      { $set: { handle: h, preorder: true }, $unset: { password_hash: '' } },
      { upsert: true }
    );
    if (r.upsertedCount) created++; else updated++;
  }
  res.json({ ok: true, created, updated, total: cleaned.length });
});

// ── 使用者：預約期註冊（白名單 + 未設定密碼）或開放期註冊 ───────────────
router.post('/preorder-register', async (req, res) => {
  try {
    const { handle = '', password = '', email = '' } = req.body || {};
    const h = String(handle || '').replace(/\u3000/g, ' ').trim();
    if (!h || !password || password.length < 6) {
      return res.json({
        ok: false,
        error: 'bad_params',
        message: '帳號必填、密碼至少 6 碼',
      });
    }

    // 開放期：任何人都可註冊（若不存在就新建；若存在但已設定密碼=回覆帳號已存在）
    if (isOpenRegister()) {
      let u = await findByHandle(h);
      if (u && u.password_hash) {
        return res.json({ ok: false, error: 'already_registered' });
      }
      if (!u) {
        u = await User.create({
          handle: h,
          email: email || undefined,
          role: 'member',
        });
      }
      const hash = await bcrypt.hash(password, 10);
      u.password_hash = hash;
      if (email) u.email = email;
      u.preorder = false;
      await u.save();

      return res.json({
        ok: true,
        token: issueToken(u),
        user: { handle: u.handle, role: u.role || 'member', email: u.email || null },
      });
    }

    // 預約期：僅限白名單 + 尚未設定密碼
    const u = await findByHandle(h);
    if (!u || !u.preorder) {
      return res.json({
        ok: false,
        error: 'not_whitelisted',
        message: '此帳號未在預約名單中',
      });
    }
    if (u.password_hash) {
      return res.json({
        ok: false,
        error: 'preorder_disabled',
        message: '此帳號已被認領',
      });
    }

    const hash = await bcrypt.hash(password, 10);
    u.password_hash = hash;
    u.email = email || u.email || null;
    u.role = u.role || 'visitor';
    await u.save();

    return res.json({
      ok: true,
      token: issueToken(u),
      user: { handle: u.handle, role: u.role || 'visitor', email: u.email || null },
    });
  } catch (e) {
    console.error('[preorder-register] error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

export default router;
