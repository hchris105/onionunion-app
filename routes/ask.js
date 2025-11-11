// routes/ask.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

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
let SYSTEM_TEXT = fs.existsSync(SUPERPROMPT_PATH) ? fs.readFileSync(SUPERPROMPT_PATH, "utf8") : "# superprompt missing";
let SYS_HASH = sha1(SYSTEM_TEXT);
let SYS_LEN = SYSTEM_TEXT.length;

// 偵測變更
try {
  fs.watch(SUPERPROMPT_PATH, { persistent: false }, () => {
    try {
      SYSTEM_TEXT = fs.readFileSync(SUPERPROMPT_PATH, "utf8");
      SYS_HASH = sha1(SYSTEM_TEXT);
      SYS_LEN = SYSTEM_TEXT.length;
      console.log("[System] superprompt.md reloaded", new Date().toISOString(), "len", SYS_LEN);
    } catch (e) {
      console.warn("[System] reload failed:", e.message);
    }
  });
} catch { /* ignore watcher errors */ }

function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex"); }

// —— OpenAI 調用（非流式）——
async function callOpenAINonStream({ question, name }) {
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const timeout = Number(process.env.OPENAI_TIMEOUT_MS || 180000);
  const controller = new AbortController();
  const tt = setTimeout(() => controller.abort(), timeout);

  const prompt = [
    `# System\n${SYSTEM_TEXT}\n`,
    `# User\n姓名：${name ?? ""}\n問題：${question}\n`
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: Number(process.env.MAX_TOKENS || 8000),
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(tt));

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  // Responses 結構：content: [{type:"output_text", text:"..."}]
  const text = data?.output_text ?? data?.content?.[0]?.text ?? JSON.stringify(data);
  return text;
}

// —— OpenAI 調用（SSE）——
async function callOpenAIStream({ question, name, res }) {
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const timeout = Number(process.env.OPENAI_TIMEOUT_MS || 180000);
  const controller = new AbortController();
  const tt = setTimeout(() => controller.abort(), timeout);

  const prompt = [
    `# System\n${SYSTEM_TEXT}\n`,
    `# User\n姓名：${name ?? ""}\n問題：${question}\n`
  ].join("\n");

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: Number(process.env.MAX_TOKENS || 8000),
      stream: true
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(tt));

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  // 轉發 Responses 的 SSE
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
    res.write(chunk); // 直接透傳 responses 的 SSE
  }
  res.write(`\n`);
  res.end();
}

// —— /ask（非流式）——
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    const question = b.question ?? b.q ?? "";
    const name = b.name ?? b.user ?? "";

    if (!question) {
      return res.status(400).json({
        ok: false,
        error: "missing_field",
        message: "缺少 question",
        sys_hash: SYS_HASH, sys_len: SYS_LEN
      });
    }

    const output = await callOpenAINonStream({ question, name });
    return res.json({ ok: true, output, sys_hash: SYS_HASH, sys_len: SYS_LEN });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, sys_hash: SYS_HASH, sys_len: SYS_LEN });
  }
});

// —— /ask/stream（SSE）——
router.post("/stream", async (req, res) => {
  try {
    const b = req.body || {};
    const question = b.question ?? b.q ?? "";
    const name = b.name ?? b.user ?? "";

    if (!question) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(`event: final\ndata: ${JSON.stringify({ ok:false, error:"missing_field", message:"缺少 question", sys_hash:SYS_HASH, sys_len:SYS_LEN })}\n\n`);
      res.write(`event: done\ndata: [DONE]\n\n`);
      return res.end();
    }
    await callOpenAIStream({ question, name, res });
  } catch (e) {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`event: final\ndata: ${JSON.stringify({ ok:false, error:e.message, sys_hash:SYS_HASH, sys_len:SYS_LEN })}\n\n`);
    res.write(`event: done\ndata: [DONE]\n\n`);
    res.end();
  }
});

export default router;
