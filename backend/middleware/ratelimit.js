// middleware/ratelimit.js — zero-deps in-memory rate limiters
import jwt from "jsonwebtoken";

// 零依賴、滑動視窗（sliding window）計數器
function makeStore() {
  const buckets = new Map(); // key -> [timestamps...]
  return {
    hit(key, windowMs, limit) {
      const now = Date.now();
      const arr = buckets.get(key) || [];
      // 清掉過窗紀錄
      const since = now - windowMs;
      while (arr.length && arr[0] < since) arr.shift();
      arr.push(now);
      buckets.set(key, arr);
      const remaining = Math.max(0, limit - arr.length);
      const reset = arr.length ? (arr[0] + windowMs) : now + windowMs;
      return { ok: arr.length <= limit, remaining, resetAt: reset, count: arr.length };
    },
    purgeOlderThan(msAgo = 60 * 60 * 1000) {
      const since = Date.now() - msAgo;
      for (const [k, v] of buckets) {
        while (v.length && v[0] < since) v.shift();
        if (!v.length) buckets.delete(k);
      }
    }
  };
}
const namedStores = new Map();
function getStore(name = "default") {
  if (!namedStores.has(name)) namedStores.set(name, makeStore());
  return namedStores.get(name);
}

// 建立一般限流中介層
export function createLimiter({ windowMs, limit, keyFn, name = "rl", headerPrefix = "X-RateLimit" }) {
  const store = getStore(name);
  return function limiter(req, res, next) {
    try {
      const key = String(keyFn(req) || req.ip || "unknown");
      const hit = store.hit(key, windowMs, limit);
      res.setHeader(`${headerPrefix}-Limit`, String(limit));
      res.setHeader(`${headerPrefix}-Remaining`, String(hit.remaining));
      res.setHeader(`${headerPrefix}-Reset`, String(Math.ceil(hit.resetAt / 1000)));
      if (!hit.ok) {
        const retry = Math.max(0, Math.ceil((hit.resetAt - Date.now()) / 1000));
        res.setHeader("Retry-After", String(retry));
        return res.status(429).json({ ok: false, error: "rate_limited", retryAfterSec: retry });
      }
      return next();
    } catch (e) {
      // 任何錯誤都直接放行，避免把限流當單點
      return next();
    }
  };
}

// 每日配額（按 key 統計，凌晨 00:00 本地時間重置）
const dayCounters = new Map(); // name -> {dayKey, map(key->count)}
function getDayCounter(name = "quota") {
  if (!dayCounters.has(name)) dayCounters.set(name, { dayKey: "", map: new Map() });
  return dayCounters.get(name);
}
function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
export function dailyQuotaLimiter({ limit, keyFn, name = "quota", headerPrefix = "X-Quota" }) {
  const counter = getDayCounter(name);
  return function quota(req, res, next) {
    try {
      const nowKey = todayKey();
      if (counter.dayKey !== nowKey) {
        counter.dayKey = nowKey;
        counter.map = new Map();
      }
      const key = String(keyFn(req) || req.ip || "unknown");
      const n = (counter.map.get(key) || 0) + 1;
      counter.map.set(key, n);
      res.setHeader(`${headerPrefix}-Day`, counter.dayKey);
      res.setHeader(`${headerPrefix}-Limit`, String(limit));
      res.setHeader(`${headerPrefix}-Used`, String(n));
      res.setHeader(`${headerPrefix}-Remaining`, String(Math.max(0, limit - n)));
      if (n > limit) {
        return res.status(429).json({ ok: false, error: "quota_exceeded", day: counter.dayKey });
      }
      return next();
    } catch (e) {
      return next();
    }
  };
}

// 從 Authorization 取 key（帶 JWT 就用 user id；否則用 IP/匿名）
export function keyFromAuth(req, jwtSecret = "change-me") {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      const payload = jwt.verify(m[1], jwtSecret);
      return `u:${payload?.id || payload?._id || "anon"}`;
    } catch {
      // token 壞掉也別擋，改用 IP 做匿名 key
    }
  }
  return `anon:${req.ip}`;
}
