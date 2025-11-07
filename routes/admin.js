// routes/admin.js  —— 容錯版，確保模型已註冊
import { Router } from "express";
import mongoose from "mongoose";

// 直接匯入模型檔，讓 Schema 在 import 時就完成註冊
import * as UserMod from "../models/User.js";
import * as PayMod  from "../models/Payment.js";

// 兼容 default export / named export / 已註冊情況
const User    = UserMod.default || UserMod.User    || mongoose.model("User");
const Payment = PayMod.default  || PayMod.Payment || mongoose.model("Payment");

const r = Router();

// 管理員驗證：.env 需有 ADMIN_TOKEN=xxxx
r.use((req, res, next) => {
  const t = (req.headers["x-admin-token"] || "").toString();
  if (!t || t !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok:false, error:"admin_auth" });
  }
  next();
});

// 查用戶（email 或 handle）
r.get("/user", async (req, res) => {
  const qRaw = (req.query.q || "").trim();
  const q = qRaw.toLowerCase();
  const u = await User.findOne({ $or: [{ email: q }, { handle: qRaw }] });
  if (!u) return res.json({ ok:false, error:"not_found" });
  res.json({
    ok:true,
    user:{
      id: u._id,
      email: u.email,
      handle: u.handle,
      role: u.role,
      trial_credits: u.trial_credits,
      preorder: !!u.preorder,
    }
  });
});

// 重置試用
r.post("/trial/reset", async (req, res) => {
  const { q, credits = 3 } = req.body || {};
  const ql = (q || "").toLowerCase();
  const u = await User.findOne({ $or: [{ email: ql }, { handle: q }] });
  if (!u) return res.json({ ok:false, error:"not_found" });
  await User.updateOne({ _id: u._id }, { $set: { trial_credits: Number(credits) || 3 } });
  res.json({ ok:true });
});

// 開通會員 N 天
r.post("/member/grant", async (req, res) => {
  const { q, days = 30, plan_id = "monthly-99" } = req.body || {};
  const ql = (q || "").toLowerCase();
  const u = await User.findOne({ $or: [{ email: ql }, { handle: q }] });
  if (!u) return res.json({ ok:false, error:"not_found" });

  const now = new Date();
  const end = new Date(Date.now() + Number(days) * 86400000);

  await Payment.create({
    user_id: u._id,
    provider: "manual",
    plan_id,
    status: "succeeded",
    period_start: now,
    period_end: end,
  });
  await User.updateOne({ _id: u._id }, { $set: { role: "member" } });

  res.json({ ok:true, until: end.toISOString() });
});

// 取消會員
r.post("/member/revoke", async (req, res) => {
  const { q } = req.body || {};
  const ql = (q || "").toLowerCase();
  const u = await User.findOne({ $or: [{ email: ql }, { handle: q }] });
  if (!u) return res.json({ ok:false, error:"not_found" });
  await User.updateOne({ _id: u._id }, { $set: { role: "visitor" } });
  res.json({ ok:true });
});

export default r;
