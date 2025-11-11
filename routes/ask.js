// routes/ask.js — 完整版（ESM）
import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── superprompt 自動載入 ─────────────────────────────
const SUPER_PATH = path.resolve(__dirname, "..", "superprompt.md");
let SYSTEM_TEXT = "You are OnionUnion · Jafar.";
let SYS_MTIME = 0;
const sha1 = (s) => crypto.createHash("sha1").update(String(s)).digest("hex");

function reloadSystem() {
  try {
    if (fs.existsSync(SUPER_PATH)) {
      const st = fs.statSync(SUPER_PATH);
      if (st.mtimeMs !== SYS_MTIME) {
        SYSTEM_TEXT = fs.readFileSync(SUPER_PATH, "utf-8");
        SYS_MTIME = st.mtimeMs;
        console.log("[System] superprompt.md reloaded", st.mtime.toISOString(), "len", SYSTEM_TEXT.length);
      }
    }
  } catch (e) {
    console.warn("[System] reload failed", e?.message || e);
  }
}
reloadSystem();
const ensureFresh = () => { try { if (fs.existsSync(SUPER_PATH) && fs.statSync(SUPER_PATH).mtimeMs !== SYS_MTIME) reloadSystem(); } catch {} };

// ── 角色/訪客策略 ─────────────────────────────────────
const VISITOR_SUFFIX =
  "（你目前為訪客模式：輸出為簡版概要。若需完整27公式合成＋高清卡片，請登入會員。）";

function getRole(req) {
  return req?.user?.role || "visitor";
}

function pickModel(body) {
  return body?._admin?.model || process.env.OPENAI_MODEL || "gpt-5";
}

function buildPrompt(b = {}) {
  const blocks = [];
  if (b.name) blocks.push(`姓名：${b.name}`);
  if (b.birthday) blocks.push(`生日：${b.birthday}`);
  if (b.mother) blocks.push(`母親姓名：${b.mother}`);
  if (b.mbti) blocks.push(`MBTI：${b.mbti}`);
  if (b.extra) blocks.push(`條件：${b.extra}`);
  if (b.question) blocks.push(`問題：${b.question}`);
  const content = blocks.join("\n");
  if (!b.question && !b.name) return { err: "至少需要『姓名或問題』其中一項。" };
  return { content, tail: "" };
}

// ── 非串流（正確路由：/ask/）──────────────────────────
router.post("/", async (req, res) => {
  ensureFresh();
  const t0 = Date.now();

  try {
    const prompt = buildPrompt(req.body);
    if (prompt.err) {
      return res.status(400).json({
        ok: false, error: "missing_field", message: prompt.err,
        sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length,
      });
    }

    const role = getRole(req);
    const model = pickModel(req.body);
    const isVisitor = role === "visitor";

    const maxTokens = Number(
      isVisitor
        ? (process.env.VISITOR_MAX_TOKENS || 300)
        : (req.body?._admin?.max_output_tokens ?? process.env.MAX_TOKENS ?? 8000)
    );

    const r = await client.responses.create({
      model,
      input: [
        { role: "system", content: SYSTEM_TEXT },
        { role: "user", content: prompt.content + (isVisitor ? `\n\n請以簡版概要回覆。${VISITOR_SUFFIX}` : "") },
      ],
      reasoning: { effort: "high" },
      text: { verbosity: "high" },
      max_output_tokens: maxTokens,
    });

    const text = (r?.output_text || "").trim();
    const answer = (text || "（沒有產出文字）") + (prompt.tail ? `\n\n${prompt.tail}` : "");

    res.json({
      ok: true, used_model: model, elapsed_ms: Date.now() - t0,
      answer, sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length,
      role,
    });
  } catch (e) {
    res.status(500).json({
      ok: false, error: "server_error", detail: String(e?.message || e),
      sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length,
    });
  }
});

// ── 串流（正確路由：/ask/stream）───────────────────────
router.post("/stream", async (req, res) => {
  ensureFresh();
  const t0 = Date.now();

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write("retry: 15000\n: ok\n\n");
  res.flushHeaders?.();

  const write = (event, data) => res.write(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`);
  const endOK = (payload = { ok: true, done: true }) => {
    try { write("done", payload); } catch {}
    try { res.write(`data: [DONE]\n\n`); } catch {}
    try { res.end(); } catch {}
  };
  const endErr = (err) => {
    try { write("error", { ok:false, error:"server_error", detail:String(err?.message||err), sys_hash:sha1(SYSTEM_TEXT), sys_len:SYSTEM_TEXT.length }); } catch {}
    endOK({ ok:false, done:true });
  };

  const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
  const clearHB = () => { try { clearInterval(hb); } catch {} };

  try {
    const prompt = buildPrompt(req.body);
    if (prompt.err) {
      write("final", { ok:false, error:"missing_field", message:prompt.err, sys_hash:sha1(SYSTEM_TEXT), sys_len:SYSTEM_TEXT.length });
      clearHB(); return endOK({ ok:false, done:true });
    }

    const role = getRole(req);
    const isVisitor = role === "visitor";
    const model = pickModel(req.body);
    const maxTokens = Number(
      isVisitor
        ? (process.env.VISITOR_MAX_TOKENS || 300)
        : (req.body?._admin?.max_output_tokens ?? process.env.MAX_TOKENS ?? 8000)
    );

    const userText = prompt.content + (isVisitor ? `\n\n請以簡版概要回覆。${VISITOR_SUFFIX}` : "");

    try {
      const stream = await client.responses.stream({
        model,
        input: [
          { role: "system", content: SYSTEM_TEXT },
          { role: "user", content: userText },
        ],
        reasoning: { effort: "high" },
        text: { verbosity: "high" },
        max_output_tokens: maxTokens,
      });

      let full = "";
      for await (const ev of stream) {
        if (ev.type === "response.output_text.delta") {
          const delta = ev.delta || "";
          if (delta) {
            full += delta;
            write("delta", { delta });
          }
        } else if (ev.type === "response.error") {
          clearHB();
          write("final", { ok:false, error:"server_error", detail:ev.error?.message||"responses stream error", answer:"", sys_hash:sha1(SYSTEM_TEXT), sys_len:SYSTEM_TEXT.length });
          return endOK({ ok:false, done:true });
        }
      }

      await stream.finalResponse().catch(() => null);

      const answer = (full.trim() || "（沒有產出文字）");
      clearHB();
      write("final", {
        ok: true, used_model: model, elapsed_ms: Date.now() - t0, answer,
        sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length, role
      });
      return endOK({ ok:true, done:true });
    } catch (e1) {
      try {
        const r = await client.responses.create({
          model,
          input: [
            { role: "system", content: SYSTEM_TEXT },
            { role: "user", content: userText },
          ],
          reasoning: { effort: "high" },
          text: { verbosity: "high" },
          max_output_tokens: maxTokens,
        });
        const text = (r?.output_text || "").trim();
        clearHB();
        write("final", {
          ok: true, used_model: model, elapsed_ms: Date.now() - t0, answer: (text || "（沒有產出文字）"),
          sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length, role
        });
        return endOK({ ok:true, done:true });
      } catch (e2) {
        clearHB(); return endErr(e2);
      }
    }
  } catch (e) {
    clearHB(); return endErr(e);
  } finally {
    try { req.on?.("close", () => endOK({ ok:false, aborted:true })); } catch {}
  }
});

export default router;
