// routes/auth.js
import express from 'express';
import cookieParser from 'cookie-parser';
import { default as User } from '../models/User.js';
import charactersService from '../services/characters.js';

const router = express.Router();
router.use(express.json());
router.use(cookieParser());

// 小工具：把使用者輸入轉成「全等、忽略大小寫」的正規表示式
function exactCaseInsens(str) {
  const esc = String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc}$`, 'i');
}

// 允許登入的狀態（白名單載入多為 preorder，這裡一律允許）
const ALLOWED_STATUSES = new Set(['preorder', 'member', 'active']);

function sanitizeUser(u) {
  if (!u) return null;
  const {
    _id,
    handle,
    email,
    roles = [],
    status,
    wechat_id,
    character_code,
    character_name,
    character_line,
    character_assigned_at,
    must_change_password,
  } = u;

  return {
    _id,
    handle,
    email,
    roles,
    status,
    wechat_id,
    character_code,
    character_name,
    character_line,
    character_assigned_at,
    must_change_password: !!must_change_password,
  };
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

// 登入：首次登入只驗證密碼，不改密碼不給進站
router.post('/login', async (req, res) => {
  try {
    const { handle, email, password } = req.body || {};
    if (!handle && !email) {
      return res
        .status(400)
        .json({ ok: false, error: 'missing_handle_or_email' });
    }
    if (!password) {
      return res
        .status(400)
        .json({ ok: false, error: 'missing_password' });
    }

    const q = email ? { email } : { handle: exactCaseInsens(handle) };

    const u = await User.findOne(q).lean();
    if (!u) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    if (!ALLOWED_STATUSES.has(u.status || 'preorder')) {
      return res.status(403).json({
        ok: false,
        error: 'status_not_allowed',
        status: u.status,
      });
    }

    const pwOk =
      String(password) === String(u.password || '') ||
      String(password) === String(u.wechat_id || '');
    if (!pwOk) {
      return res
        .status(401)
        .json({ ok: false, error: 'invalid_password' });
    }

    // 判斷是否必須先改密碼
    const mustChange =
      u.must_change_password === true ||
      (u.status === 'preorder' && u.must_change_password !== false);

    if (mustChange) {
      // 首次登入：只告訴前端需要改密碼，不發 cookie、不抽角色
      return res.status(403).json({
        ok: false,
        error: 'must_change_password',
        need_password_change: true,
        message: '首次登入請先變更密碼，完成後將獎勵抽取角色一次。',
        user: sanitizeUser(u),
      });
    }

    // 正常登入流程（已經改過密碼）
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

// 首次登入／改密碼：完成後才給登入＋抽角色一次
// Body: { handle 或 email, old_password, new_password }
router.post('/change-password', async (req, res) => {
  try {
    const { handle, email, old_password, new_password } = req.body || {};

    if (!handle && !email) {
      return res
        .status(400)
        .json({ ok: false, error: 'missing_handle_or_email' });
    }
    if (!old_password || !new_password) {
      return res.status(400).json({
        ok: false,
        error: 'missing_password_fields',
        message: 'old_password 與 new_password 必填',
      });
    }

    // 新密碼不得與舊密碼相同
    if (String(old_password) === String(new_password)) {
      return res.status(400).json({
        ok: false,
        error: 'password_not_changed',
        message: '新密碼不得與舊密碼相同',
      });
    }

    if (String(new_password).length < 6) {
      return res.status(400).json({
        ok: false,
        error: 'new_password_too_short',
        message: '新密碼至少需要 6 個字元',
      });
    }

    const q = email ? { email } : { handle: exactCaseInsens(handle) };
    let u = await User.findOne(q).lean();
    if (!u) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }

    if (!ALLOWED_STATUSES.has(u.status || 'preorder')) {
      return res.status(403).json({
        ok: false,
        error: 'status_not_allowed',
        status: u.status,
      });
    }

    const pwOk =
      String(old_password) === String(u.password || '') ||
      String(old_password) === String(u.wechat_id || '');
    if (!pwOk) {
      return res
        .status(401)
        .json({ ok: false, error: 'invalid_old_password' });
    }

    const mustChange =
      u.must_change_password === true ||
      (u.status === 'preorder' && u.must_change_password !== false);

    const newPw = String(new_password);

    // ✅ 強制寫入 password + must_change_password（用原生 collection，避免怪問題）
    await User.collection.updateOne(
      { _id: u._id },
      {
        $set: {
          password: newPw,
          must_change_password: false,
        },
      }
    );

    // 再讀一次最新的 user
    u = await User.findById(u._id).lean();

    let rewardedCharacter = null;

    if (mustChange) {
      // 首次改密碼 → 獎勵抽角色一次
      try {
        const draw = await charactersService.grantRandomCharacter(
          u.handle,
          'preorder500'
        );
        if (!draw.noAvailable && draw.character) {
          const c = draw.character;
          rewardedCharacter = {
            code: c.code,
            name: c.name || null,
            line: c.line || null,
            tags: c.tags || [],
            rarity: c.rarity || null,
          };

          // 抽完角色後，再同步一次最新 user（包含 character_* 欄位）
          u = await User.findById(u._id).lean();
        }
      } catch (err) {
        console.error(
          '[auth/change-password] grantRandomCharacter error:',
          err
        );
      }
    }

    // 改完密碼就直接登入（發 sid cookie）
    res.cookie('sid', String(u._id), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 3600 * 1000,
      path: '/',
    });

    return res.json({
      ok: true,
      changed: true,
      rewarded: !!rewardedCharacter,
      user: sanitizeUser(u),
      character: rewardedCharacter,
    });
  } catch (e) {
    console.error('[auth/change-password] error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// 登出
router.post('/logout', (req, res) => {
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

export default router;
