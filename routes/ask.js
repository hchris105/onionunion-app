// routes/ask.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";

import db from "../services/db.js";
import User from "../models/User.js";

const { mongoose } = db;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

// 解析 cookie（用 sid 找登入中的 user）
router.use(cookieParser());

// 看得到現在載入哪支檔（除錯很有用）
console.log("[ask] using", import.meta.url);

// —— 保底解析（若 body 是字串或被反代吃掉，這裡自救）——
router.use((req, _res, next) => {
  if (typeof req.body === "string") {
    try { req.body = JSON.parse(req.body); } catch {}
  }
  next();
});

// —— superprompt 熱重載 —— 
const SUPERPROMPT_PATH = path.resolve(__dirname, "..", "superprompt.md");
let SYSTEM_TEXT = fs.existsSync(SUPERPROMPT_PATH)
  ? fs.readFileSync(SUPERPROMPT_PATH, "utf8")
  : "# superprompt missing";
let SYS_HASH = sha1(SYSTEM_TEXT);
let SYS_LEN = SYSTEM_TEXT.length;

try {
  fs.watch(SUPERPROMPT_PATH, { persistent: false }, () => {
    try {
      SYSTEM_TEXT = fs.readFileSync(SUPERPROMPT_PATH, "utf8");
      SYS_HASH = sha1(SYSTEM_TEXT);
      SYS_LEN = SYSTEM_TEXT.length;
      console.log(
        "[System] superprompt.md reloaded",
        new Date().toISOString(),
        "len",
        SYS_LEN
      );
    } catch (e) {
      console.warn("[System] reload failed:", e.message);
    }
  });
} catch {
  /* ignore watcher errors */
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

// === 共用小工具 ===

// 從 req 找出目前 user（依 sid cookie）
async function getUserFromReq(req) {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  try {
    const u = await User.findById(sid).lean();
    return u || null;
  } catch (e) {
    console.warn("[ask] getUserFromReq error:", e.message || e);
    return null;
  }
}

// 只允許 active 會員使用 /ask
function ensureActiveUser(u) {
  if (!u) {
    return {
      ok: false,
      code: "unauthorized",
      message: "請先登入會員帳號再使用此服務。",
    };
  }
  if (u.status !== "active") {
    return {
      ok: false,
      code: "not_active_member",
      message: "目前僅限正式會員（status = active）使用此服務。",
    };
  }
  return { ok: true };
}

// SSE 錯誤輸出 helper
function sendSseError(res, payload) {
  res.setHeader("Content-Type", "text/event-stream");
  res.write(`event: final\ndata: ${JSON.stringify(payload)}\n\n`);
  res.write(`event: done\ndata: [DONE]\n\n`);
  res.end();
}

// === usage 記錄小工具 ===

// 從 req 推一個 handle：優先拿 user.handle，其次 body.handle
function getHandleFromReq(req) {
  if (req.user?.handle) return req.user.handle;
  const body = req.body || {};
  return body.handle || null;
}

// 非阻塞記錄 usage：寫失敗只會 log，不會拖累 /ask
async function recordUsage(req, payload) {
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1) {
      console.warn("[usage] mongoose not connected, skip usage record");
      return;
    }
    const col = conn.collection("usage");

    const doc = {
      ts: new Date(),
      route: payload.route || "/ask",
      model: payload.model || (process.env.OPENAI_MODEL || "gpt-5"),
      handle: getHandleFromReq(req),

      input_tokens: payload.inputTokens ?? 0,
      output_tokens: payload.outputTokens ?? 0,
      elapsed_ms: payload.elapsedMs ?? 0,

      approx_input_chars: payload.approxInputChars ?? 0,
      approx_output_chars: payload.approxOutputChars ?? 0,

      status: payload.status || "ok",
      error: payload.error || "",
      is_stream: !!payload.isStream,
    };

    await col.insertOne(doc);
  } catch (err) {
    console.error("[usage] record failed:", err.message || err);
  }
}

// === OpenAI 調用（非流式）===

async function callOpenAINonStream({ question, name }) {
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const timeout = Number(process.env.OPENAI_TIMEOUT_MS || 180000);
  const controller = new AbortController();
  const tt = setTimeout(() => controller.abort(), timeout);

  const prompt = [
    `# System\n${SYSTEM_TEXT}\n`,
    `# User\n姓名：${name ?? ""}\n問題：${question}\n`,
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: Number(process.env.MAX_TOKENS || 8000),
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(tt));

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();

  const text =
    data?.output_text ??
    data?.content?.[0]?.text ??
    JSON.stringify(data);

  const usage = data?.usage || {};

  return { text, usage, model };
}

// === OpenAI 調用（SSE）===

async function callOpenAIStream({ question, name, res }) {
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const timeout = Number(process.env.OPENAI_TIMEOUT_MS || 180000);
  const controller = new AbortController();
  const tt = setTimeout(() => controller.abort(), timeout);

  const prompt = [
    `# System\n${SYSTEM_TEXT}\n`,
    `# User\n姓名：${name ?? ""}\n問題：${question}\n`,
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: Number(process.env.MAX_TOKENS || 8000),
      stream: true,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(tt));

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    res.write(chunk);
  }
  res.write(`\n`);
  res.end();
}

// === /ask（非流式）===

router.post("/", async (req, res) => {
  const t0 = Date.now();
  try {
    // 1) 確認登入 & active
    const user = await getUserFromReq(req);
    const gate = ensureActiveUser(user);
    if (!gate.ok) {
      const payload = {
        ok: false,
        error: gate.code,
        message: gate.message,
        sys_hash: SYS_HASH,
        sys_len: SYS_LEN,
      };

      recordUsage(req, {
        route: "/ask",
        model: process.env.OPENAI_MODEL || "gpt-5",
        inputTokens: 0,
        outputTokens: 0,
        elapsedMs: Date.now() - t0,
        approxInputChars: 0,
        approxOutputChars: 0,
        status: gate.code,
        error: gate.message,
        isStream: false,
      }).catch(() => {});

      return res.status(gate.code === "unauthorized" ? 401 : 403).json(payload);
    }
    // 給 usage 用
    req.user = user;

    const b = req.body || {};
    const question = b.question ?? b.q ?? "";
    const name = b.name ?? b.user ?? "";

    if (!question) {
      return res.status(400).json({
        ok: false,
        error: "missing_field",
        message: "缺少 question",
        sys_hash: SYS_HASH,
        sys_len: SYS_LEN,
      });
    }

    const { text, usage } = await callOpenAINonStream({ question, name });
    const elapsed = Date.now() - t0;

    const inputTokens =
      usage?.input_tokens ??
      usage?.prompt_tokens ??
      0;
    const outputTokens =
      usage?.output_tokens ??
      usage?.completion_tokens ??
      0;

    const approxInputChars =
      String(question || "").length +
      String(name || "").length +
      SYS_LEN;
    const approxOutputChars = String(text || "").length;

    recordUsage(req, {
      route: "/ask",
      model: process.env.OPENAI_MODEL || "gpt-5",
      inputTokens,
      outputTokens,
      elapsedMs: elapsed,
      approxInputChars,
      approxOutputChars,
      status: "ok",
      isStream: false,
    }).catch(() => {});

    return res.json({
      ok: true,
      output: text,
      sys_hash: SYS_HASH,
      sys_len: SYS_LEN,
    });
  } catch (e) {
    const msg = e?.message || String(e);

    recordUsage(req, {
      route: "/ask",
      model: process.env.OPENAI_MODEL || "gpt-5",
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: Date.now() - t0,
      approxInputChars: 0,
      approxOutputChars: 0,
      status: "error",
      error: msg,
      isStream: false,
    }).catch(() => {});

    return res.status(500).json({
      ok: false,
      error: msg,
      sys_hash: SYS_HASH,
      sys_len: SYS_LEN,
    });
  }
});

// === /ask/stream（SSE）===

router.post("/stream", async (req, res) => {
  const t0 = Date.now();
  try {
    // 1) 確認登入 & active
    const user = await getUserFromReq(req);
    const gate = ensureActiveUser(user);
    if (!gate.ok) {
      const payload = {
        ok: false,
        error: gate.code,
        message: gate.message,
        sys_hash: SYS_HASH,
        sys_len: SYS_LEN,
      };

      recordUsage(req, {
        route: "/ask/stream",
        model: process.env.OPENAI_MODEL || "gpt-5",
        inputTokens: 0,
        outputTokens: 0,
        elapsedMs: Date.now() - t0,
        approxInputChars: 0,
        approxOutputChars: 0,
        status: gate.code,
        error: gate.message,
        isStream: true,
      }).catch(() => {});

      return sendSseError(res, payload);
    }
    req.user = user;

    const b = req.body || {};
    const question = b.question ?? b.q ?? "";
    const name = b.name ?? b.user ?? "";

    if (!question) {
      const payload = {
        ok: false,
        error: "missing_field",
        message: "缺少 question",
        sys_hash: SYS_HASH,
        sys_len: SYS_LEN,
      };
      return sendSseError(res, payload);
    }

    await callOpenAIStream({ question, name, res });

    const elapsed = Date.now() - t0;
    const approxInputChars =
      String(question || "").length +
      String(name || "").length +
      SYS_LEN;

    recordUsage(req, {
      route: "/ask/stream",
      model: process.env.OPENAI_MODEL || "gpt-5",
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: elapsed,
      approxInputChars,
      approxOutputChars: 0,
      status: "ok",
      isStream: true,
    }).catch(() => {});
  } catch (e) {
    const msg = e?.message || String(e);

    recordUsage(req, {
      route: "/ask/stream",
      model: process.env.OPENAI_MODEL || "gpt-5",
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: Date.now() - t0,
      approxInputChars: 0,
      approxOutputChars: 0,
      status: "error",
      error: msg,
      isStream: true,
    }).catch(() => {});

    const payload = {
      ok: false,
      error: msg,
      sys_hash: SYS_HASH,
      sys_len: SYS_LEN,
    };
    return sendSseError(res, payload);
  }
});

export default router;
