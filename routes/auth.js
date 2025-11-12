// routes/auth.js
import express from 'express';
import cookieParser from 'cookie-parser';
import { default as User } from '../models/User.js';

const router = express.Router();
router.use(express.json());
router.use(cookieParser());

// 小工具：把使用者輸入轉成「全等、忽略大小寫」的正規表示式
function exactCaseInsens(str) {
  const esc = String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc}$`, 'i');
}

// 允許登入的狀態（白名單載入多為 preorder，這裡一律允許）
const ALLOWED_STATUSES = new Set(['preorder', 'member', 'active']);

function sanitizeUser(u) {
  if (!u) return null;
  const { _id, handle, email, roles = [], status, wechat_id } = u;
  return { _id, handle, email, roles, status, wechat_id };
}

// Debug：檢查 auth 路由活著
router.get('/_debug/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), note: 'auth router alive' });
});

// 取得當前使用者
router.get('/me', async (req, res) => {
  try {
    const sid = req.cookies?.sid;
    if (!sid) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const u = await User.findById(sid).lean();
    if (!u) return res.status(401).json({ ok: false, error: 'unauthorized' });

    return res.json({ ok: true, user: sanitizeUser(u) });
  } catch (e) {
    console.error('[auth/me] error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// 登入：接受 handle 或 email；密碼接受 password 或 wechat_id（當作初始密碼）
router.post('/login', async (req, res) => {
  try {
    const { handle, email, password } = req.body || {};
    if (!handle && !email) {
      return res.status(400).json({ ok: false, error: 'missing_handle_or_email' });
    }
    if (!password) {
      return res.status(400).json({ ok: false, error: 'missing_password' });
    }

    // 以「忽略大小寫」查 handle；或用 email 精確查
    const q = email
      ? { email }
      : { handle: exactCaseInsens(handle) };

    const u = await User.findOne(q).lean();
    if (!u) return res.status(404).json({ ok: false, error: 'user_not_found' });

    // 狀態允許
    if (!ALLOWED_STATUSES.has(u.status || 'preorder')) {
      return res.status(403).json({ ok: false, error: 'status_not_allowed', status: u.status });
    }

    // 密碼比對：允許等於 password 或等於 wechat_id（你的規格）
    const pwOk =
      String(password) === String(u.password || '') ||
      String(password) === String(u.wechat_id || '');

    if (!pwOk) {
      return res.status(401).json({ ok: false, error: 'invalid_password' });
    }

    // 設置 cookie 作為簡單會話（之後有需要可換 JWT）
    res.cookie('sid', String(u._id), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 3600 * 1000,
      path: '/',
    });

    return res.json({ ok: true, user: sanitizeUser(u) });
  } catch (e) {
    console.error('[auth/login] error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// 登出
router.post('/logout', (req, res) => {
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

export default router;
