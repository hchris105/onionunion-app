// routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { isOpen, openGate, closeGate } from '../lib/gate.js';

const router = Router();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

function requireAdmin(req, res, next) {
  const t = req.get('X-Admin-Token') || '';
  if (!t || t !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

/** Admin：新增白名單（單筆） */
router.post('/admin/add-preorder', requireAdmin, async (req, res) => {
  try {
    const { email, handle, name } = req.body || {};
    if (!email || !handle) return res.status(400).json({ ok: false, error: 'email & handle required' });

    const existed = await User.findOne({ $or: [{ email: email.toLowerCase() }, { handle: handle.toLowerCase() }] });
    if (existed && existed.status === 'active') return res.status(409).json({ ok: false, error: 'already active' });

    await User.updateOne(
      { email: email.toLowerCase() },
      { $set: { email: email.toLowerCase(), handle: handle.toLowerCase(), name: name || null, status: 'preorder', password_hash: null, must_reset_password: false } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** Admin：開/關白名單註冊 */
router.post('/admin/preorder-register-open', requireAdmin, (req, res) => { openGate(); res.json({ ok: true, open: isOpen() }); });
router.post('/admin/preorder-register-close', requireAdmin, (req, res) => { closeGate(); res.json({ ok: true, open: isOpen() }); });

/** 前台：白名單自助註冊（無需逐人 token）
 * body: { email, handle, password }
 * 條件：OPEN_REGISTER=1 且使用者在白名單(status=preorder、尚未有 password_hash)
 */
router.post('/preorder-register', async (req, res) => {
  try {
    if (!isOpen()) return res.status(403).json({ ok: false, error: 'register closed' });

    const { email, handle, password } = req.body || {};
    if (!email || !handle || !password) return res.status(400).json({ ok: false, error: 'email/handle/password required' });

    const u = await User.findOne({ email: email.toLowerCase() });
    if (!u || u.status !== 'preorder') return res.status(403).json({ ok: false, error: 'not in whitelist' });
    if (u.handle.toLowerCase() !== handle.toLowerCase()) return res.status(400).json({ ok: false, error: 'handle mismatch' });
    if (u.password_hash || u.status === 'active') return res.status(409).json({ ok: false, error: 'already registered' });

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    u.password_hash = password_hash;
    u.status = 'active';
    u.must_reset_password = false;
    u.registered_at = new Date();
    await u.save();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** 登入（只允許 active） */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = await User.findOne({ email: (email || '').toLowerCase() });
    if (!u || u.status !== 'active' || !u.password_hash) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const ok = await bcrypt.compare(password || '', u.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    if (u.must_reset_password) return res.status(423).json({ ok: false, error: 'must_reset_password' });
    res.json({ ok: true, user: { id: u.id, email: u.email, handle: u.handle, status: u.status } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
