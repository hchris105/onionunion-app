// routes/auth.js — OnionUnion Auth（嚴格 wechat 比對、可選自動抽卡、/me 安全輸出 + 專屬限流）
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createLimiter } from "../middleware/ratelimit.js";

const DEBUG = ["1","true","yes"].includes(String(process.env.DEBUG_AUTH||"").toLowerCase());
const router = express.Router();

// ---- User model（外部若已定義則沿用）----
let User;
try { User = mongoose.model("User"); } catch {
  const userSchema = new mongoose.Schema({
    handle: { type: String, index: true },
    email:  { type: String, index: true, sparse: true },
    wechat_id: { type: String, index: true, sparse: true },
    status: { type: String, default: "preorder", index: true },
    password_hash: { type: String },
    roles: { type: [String], default: [] },
    meta:  { type: Object, default: {} },
    last_login_at: { type: Date },
    classState: { type: Object, default: {} },
    counters:   { type: Object, default: { trialLeft: 3, usedCount: 0 } },
    nickname:   { type: String, default: "" },
    must_reset_password: { type: Boolean, default: false },
    role_ticket_code: { type: String, default: null },
  }, { collection: "users", timestamps: true });
  userSchema.index({ handle: 1 }, { unique: true });
  userSchema.index({ email: 1 }, { unique: true, sparse: true });
  userSchema.index({ wechat_id: 1 }, { unique: true, sparse: true });
  User = mongoose.model("User", userSchema);
}

// ---- helpers ----
const iEq = (v)=>({ $regex: new RegExp(`^${String(v).replace(/[.*+?^${}()|[\\]\\\\]/g,"\\$&")}$`, "i") });
const buildIdentifierQuery = (identifier)=>{
  const ident = String(identifier||"").trim();
  if (!ident) return null;
  const ors = [{ handle:iEq(ident) }, { wechat_id:iEq(ident) }];
  if (ident.includes("@")) ors.push({ email:iEq(ident) });
  return { $or: ors };
};
function signToken(user){
  const payload = { id:String(user._id), handle:user.handle, roles:user.roles||[] };
  const secret = process.env.JWT_SECRET || "change-me";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(payload, secret, { expiresIn });
}

// ====== 每路限流器 ======
const loginIpLimiter   = createLimiter({ windowMs: 60*1000,      limit: Number(process.env.RL_LOGIN_IP_1M||10),   keyFn: (r)=> r.ip, name:"login:ip" });
const loginAcctLimiter = createLimiter({ windowMs: 15*60*1000,   limit: Number(process.env.RL_LOGIN_ACCT_15M||30), keyFn: (r)=> `acct:${String(r.body?.identifier||"").toLowerCase()}`, name:"login:acct" });

const claimIpLimiter   = createLimiter({ windowMs: 15*60*1000,   limit: Number(process.env.RL_CLAIM_IP_15M||5),    keyFn: (r)=> r.ip, name:"claim:ip" });
const claimAcctLimiter = createLimiter({ windowMs: 15*60*1000,   limit: Number(process.env.RL_CLAIM_ACCT_15M||3),  keyFn: (r)=> `h:${String(r.body?.handle||"").toLowerCase()}`, name:"claim:acct" });

const lookupIpLimiter  = createLimiter({ windowMs: 15*60*1000,   limit: Number(process.env.RL_LOOKUP_IP_15M||60),  keyFn: (r)=> r.ip, name:"lookup:ip" });

// ===== 0) _debug =====
router.get("/_debug/:identifier", async (req,res)=>{
  try{
    if (!DEBUG) return res.status(404).json({ ok:false, error:"debug_off" });
    const q = buildIdentifierQuery(req.params.identifier);
    const u = q ? await User.findOne(q).lean() : null;
    return res.json({ ok: !!u, query:q, user: u || null });
  }catch(e){ return res.status(500).json({ ok:false, error:"server_error", detail:String(e?.message||e) }); }
});

// ===== 1) 預約查詢（限流：IP 60/15m） =====
router.post("/preorder-lookup", lookupIpLimiter, async (req,res)=>{
  try{
    const { handle } = req.body||{};
    if (!handle) return res.status(400).json({ ok:false, error:"missing_handle" });
    const u = await User.findOne({ handle:iEq(handle) })
      .select({ handle:1, status:1, password_hash:1 }).lean();
    if (!u) return res.json({ ok:true, exists:false });
    const claimed = Boolean(u.password_hash);
    return res.json({ ok:true, exists:true, claimed, status:u.status||"preorder" });
  }catch(e){ return res.status(500).json({ ok:false, error:"server_error", detail:String(e?.message||e) }); }
});

// ===== 2) 認領（名單必須已有 wechat 且一致；限流：IP 5/15m + 帳號 3/15m） =====
router.post("/claim", claimIpLimiter, claimAcctLimiter, async (req,res)=>{
  try{
    let { handle, wechat, new_password } = req.body||{};
    if (!handle || !new_password) return res.status(400).json({ ok:false, error:"missing_params" });

    handle = String(handle).trim();
    wechat = wechat ? String(wechat).trim().toLowerCase() : "";

    const doc = await User.findOne({ handle:iEq(handle) });
    if (!doc) return res.status(404).json({ ok:false, error:"not_found" });

    const st = doc.status || "preorder";
    if (!["preorder","active"].includes(st)) return res.status(400).json({ ok:false, error:"invalid_status" });
    if (st==="active" && doc.password_hash) return res.status(409).json({ ok:false, error:"already_claimed" });

    const existingWx = (doc.wechat_id||"").trim().toLowerCase();
    if (!existingWx) return res.status(400).json({ ok:false, error:"no_wechat_on_file", message:"白名單缺少微信號，請人工協助" });
    if (!wechat)    return res.status(400).json({ ok:false, error:"missing_wechat", message:"請輸入綁定的微信號" });
    if (existingWx !== wechat) return res.status(409).json({ ok:false, error:"wechat_mismatch", message:"微信號不匹配，請人工協助" });

    const rounds = Number(process.env.BCRYPT_ROUNDS||12);
    doc.password_hash = await bcrypt.hash(String(new_password), rounds);
    doc.status = "active";
    await doc.save();

    if (process.env.ROLES_AUTODRAW === "1") {
      try{
        const mod = await import("../services/roles.js").catch(()=>null);
        const drawRoleForUser = mod?.drawRoleForUser;
        const hasRole = Array.isArray(doc.roles) && doc.roles.length>0;
        if (typeof drawRoleForUser === "function" && !hasRole){
          const ticket = await drawRoleForUser(doc._id);
          if (ticket){
            await User.findByIdAndUpdate(doc._id, {
              $addToSet:{ roles: ticket.tier },
              $set: { "meta.role_ticket_code": ticket.code, role_ticket_code: ticket.code }
            });
          }
        }
      }catch(e){ if (DEBUG) console.warn("[roles] auto-draw skipped:", e?.message||e); }
    }

    const token = signToken(doc);
    return res.json({ ok:true, handle:doc.handle, status:doc.status, wechat_id:doc.wechat_id||null, token });
  }catch(e){ return res.status(500).json({ ok:false, error:"server_error", detail:String(e?.message||e) }); }
});

// ===== 3) 登入（限流：IP 10/1m + 帳號 30/15m） =====
router.post("/login", loginIpLimiter, loginAcctLimiter, async (req,res)=>{
  try{
    const { identifier, password } = req.body||{};
    if (!identifier || !password) return res.status(400).json({ ok:false, error:"missing_params" });

    const q = buildIdentifierQuery(identifier);
    if (!q) return res.status(400).json({ ok:false, error:"invalid_identifier" });

    const u = await User.findOne(q)
      .select({ handle:1, status:1, password_hash:1, wechat_id:1, roles:1, meta:1 }).lean();
    if (!u) return res.status(404).json({ ok:false, error:"not_found" });
    if (u.status === "disabled") return res.status(403).json({ ok:false, error:"disabled" });
    if (!u.password_hash) return res.status(409).json({ ok:false, error:"not_claimed" });

    const ok = await bcrypt.compare(String(password), u.password_hash);
    if (!ok) return res.status(401).json({ ok:false, error:"bad_password" });

    const token = signToken(u);
    User.updateOne({ _id:u._id }, { $set:{ last_login_at:new Date() } }).catch(()=>{});
    return res.json({ ok:true, token, user:{
      handle:u.handle, status:u.status, wechat_id:u.wechat_id||null,
      roles:u.roles||[], role_ticket_code: u?.meta?.role_ticket_code || null
    }});
  }catch(e){ return res.status(500).json({ ok:false, error:"server_error", detail:String(e?.message||e) }); }
});

// ===== 4) /me（只排除敏感欄位） =====
function authz(req,res,next){
  const h = req.headers.authorization || ""; const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok:false, error:"NO_TOKEN" });
  try{ req.user = jwt.verify(m[1], process.env.JWT_SECRET||"change-me"); next(); }
  catch{ return res.status(401).json({ ok:false, error:"BAD_TOKEN" }); }
}
router.get("/me", authz, async (req,res)=>{
  try{
    const u = await User.findById(req.user.id).select("-password_hash -__v").lean();
    if (!u) return res.status(404).json({ ok:false, error:"NOT_FOUND" });

    const roleTicket = u.role_ticket_code || u?.meta?.role_ticket_code || null;
    u.role_ticket_code = roleTicket;

    u.classState ||= { tier:"民層", family:null, title:null, level:1, tearExp:0, slotId:null };
    u.counters   ||= { trialLeft:3, usedCount:0 };
    if (typeof u.must_reset_password !== "boolean") u.must_reset_password = false;

    return res.json({ ok:true, user:u });
  }catch(e){ return res.status(500).json({ ok:false, error:"server_error", detail:String(e?.message||e) }); }
});

export default router;
