// middleware/admin.js
export function adminGuard(req, res, next) {
  // 1) 允許 JWT 角色為 admin
  const user = req.user || null; // 如果你已經有 /auth 驗證中介層
  if (user && user.role === 'admin') return next();

  // 2) 允許以固定的 ADMIN_TOKEN 存取（例如從你的管理頁送 Authorization: Bearer <ADMIN_TOKEN>）
  const hdr = req.get('Authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (token && process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return next();

  return res.status(403).json({ ok:false, error:'forbidden' });
}
