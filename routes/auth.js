// routes/auth.js
import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { hashPassword, verifyPassword } from '../lib/hash.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// 統一簽發 token
function signToken(user) {
  const payload = {
    uid: user._id.toString(),
    handle: user.handle,
    roles: user.roles || [],
    status: user.status || 'preorder',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/**
 * POST /auth/login
 * body: { handle, password }
 * - 驗證成功 => 200 { token, need_reset:false, profile:{...} }
 * - 需要強制改密 => 403 { code:"MUST_RESET_PASSWORD" }
 */
router.post('/login', async (req, res) => {
  try {
    const { handle, password } = req.body || {};
    if (!handle || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' });

    const user = await User.findOne({ handle }).lean(false);
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    const ok = await verifyPassword(user.password, password);
    if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    // 首次登入必須改密
    if (user.must_reset_password) {
      return res.status(403).json({ code: 'MUST_RESET_PASSWORD' });
    }

    const token = signToken(user);
    return res.json({
      token,
      need_reset: false,
      profile: {
        handle: user.handle,
        roles: user.roles,
        status: user.status,
        email: user.email || '',
        wechat_id: user.wechat_id || '',
      },
    });
  } catch (e) {
    console.error('[auth/login] error:', e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});

/**
 * POST /auth/reset-password
 * body: { handle, old_password, new_password }
 * - old_password 正確 => 重設為 bcrypt 並清除 must_reset_password
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { handle, old_password, new_password } = req.body || {};
    if (!handle || !old_password || !new_password) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    const user = await User.findOne({ handle }).lean(false);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });

    const ok = await verifyPassword(user.password, old_password);
    if (!ok) return res.status(401).json({ error: 'INVALID_OLD_PASSWORD' });

    user.password = await hashPassword(new_password);
    user.must_reset_password = false;
    await user.save();

    const token = signToken(user);
    return res.json({ ok: true, token });
  } catch (e) {
    console.error('[auth/reset-password] error:', e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});

export default router;
