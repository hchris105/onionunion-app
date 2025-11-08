// middleware/adminBasic.js  (ESM)
export default function adminBasic(req, res, next) {
  const user = (process.env.ADMIN_USER || '').trim();
  const pass = (process.env.ADMIN_PASS || '').trim();

  // 若沒設定帳密，直接略過（避免鎖死自己）
  if (!user || !pass) return next();

  const hdr = req.headers['authorization'] || '';
  if (!hdr.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="OnionUnion Admin"');
    return res.status(401).send('Auth required');
  }

  try {
    const [u, p] = Buffer.from(hdr.slice(6), 'base64').toString('utf8').split(':');
    if (u === user && p === pass) return next();
  } catch (_) {/* ignore */}

  res.set('WWW-Authenticate', 'Basic realm="OnionUnion Admin"');
  return res.status(401).send('Invalid credentials');
}
