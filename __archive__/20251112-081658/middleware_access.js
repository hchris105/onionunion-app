// middleware/access.js
import Payment from "../models/Payment.js";
import User from "../models/User.js";

async function hasActivePlan(userId) {
  const now = new Date();
  return !!(await Payment.findOne({
    user_id: userId,
    status: "succeeded",
    period_end: { $gt: now }
  }).lean());
}

/**
 * gateAsk：
 * - 會員：可 composite（27 合成）
 * - 非會員（含未登入）：只允許 single；登入者且 trial_credits>0 才能用，成功後扣1
 */
export async function gateAsk(req, res, next) {
  const u = req.user || null;
  const b = req.body || {};
  const wantComposite = b.mode === "composite";

  let isMember = false;
  if (u) isMember = (u.role === "member") || (await hasActivePlan(u._id));

  if (!isMember) {
    if (wantComposite) {
      return res.status(402).json({ ok:false, error:"member_required", message:"27 公式合成需會員。" });
    }
    if (!u) {
      return res.status(401).json({ ok:false, error:"auth_required", message:"請先登入以使用試用次數。" });
    }
    if ((u.trial_credits ?? 0) <= 0) {
      return res.status(402).json({ ok:false, error:"trial_exhausted", message:"試用次數已用完，請升級會員。" });
    }
    req._willConsumeTrial = true;      // 成功回覆後才扣
    req._userIdForTrial   = u._id;
  }

  req._mode = isMember ? "composite" : "single";
  next();
}

/** 在 ask 成功後呼叫，扣 1 次試用 */
export async function consumeTrialIfNeeded(req) {
  if (req._willConsumeTrial && req._userIdForTrial) {
    await User.updateOne({ _id: req._userIdForTrial }, { $inc: { trial_credits: -1 } });
  }
}
