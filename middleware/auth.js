// middleware/auth.js — 最前面加入放行規則
export default function gate(req, res, next) {
  // 不要攔截 /ask 與 /ask/stream，避免破壞 SSE
  if (
    req.method === "POST" &&
    (req.path === "/ask" || req.path === "/ask/stream")
  ) {
    return next();
  }

  // 你原有的會員/白名單/角色判斷留在這下面
  // e.g. 解析 JWT，注入 req.user / req.role
  try {
    // ...你的原邏輯...
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}
