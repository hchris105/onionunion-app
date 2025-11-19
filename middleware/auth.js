// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// 可選登入：有帶 Bearer token 就解析；沒帶就當訪客
export async function requireAuthOptional(req, _res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const m = hdr.match(/^Bearer (.+)$/i);
    if (m) {
      const payload = jwt.verify(m[1], process.env.JWT_SECRET);
      req.user = await User.findById(payload.sub).lean();
    }
  } catch (_e) { /* 壞 token 視同未登入 */ }
  next();
}
