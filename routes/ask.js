// routes/ask.js — Responses 原生串流 + GPT-5 high；superprompt 熱重載與校驗；會員/訪客模式插行
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------
// 延遲初始化：確保 .env 已載入後才取用
// ---------------------------
let _client = null;
function getClient() {
  if (_client) return _client;

  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY missing");

  _client = new OpenAI({
    apiKey: key,
    organization: process.env.OPENAI_ORG_ID || undefined,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 15000),
    maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 1),
  });
  return _client;
}

// ---- superprompt 熱重載 + 校驗
let SYSTEM_TEXT = "";
let lastMtime = 0;
const superPath = path.join(__dirname, "..", "superprompt.md");

function sha1(s) {
  return crypto.createHash("sha1").update(s || "", "utf8").digest("hex");
}

function loadSystem(fallback = "") {
  try {
    const stat = fs.statSync(superPath);
    if (stat.mtimeMs !== lastMtime) {
      SYSTEM_TEXT = fs.readFileSync(superPath, "utf8");
      lastMtime = stat.mtimeMs;
      console.log(
        "[System] superprompt.md reloaded:",
        new Date(stat.mtime).toISOString(),
        "| len=", SYSTEM_TEXT.length,
        "| sha1=", sha1(SYSTEM_TEXT)
      );
    }
  } catch {
    SYSTEM_TEXT = fallback || process.env.SYS_PROMPT || "You are OnionUnion assistant.";
    console.log("[System] superprompt.md not found, fallback len=", SYSTEM_TEXT.length, "sha1=", sha1(SYSTEM_TEXT));
  }
}
// 首次載入 + 監看檔案（1.5s）
loadSystem();
try { fs.watchFile(superPath, { interval: 1500 }, () => loadSystem()); } catch {}

// ---- 公用：把 req.body 組成 prompt
const FORCE_ALGO_TAG = (process.env.FORCE_ALGO_TAG ?? "1") !== "0";

function buildPrompt(req) {
  const appCfg = req._appCfg || {};
  if (appCfg.master_system_prompt && appCfg.master_system_prompt !== SYSTEM_TEXT) {
    SYSTEM_TEXT = String(appCfg.master_system_prompt || "");
  }

  const b = req.body || {};
  const name     = b.name || b.myName || "";
  const mother   = b.mother_name || b.myMother || "";
  const birth    = b.birth || b.myBirth || "";
  const question = b.question || b.q || "";
  if (!question) return { err: "缺少 question" };

  const ctrlLine = FORCE_ALGO_TAG
    ? "※ 請在回覆開頭（第一段）明確標注本次採用的【主算法#id 與備選算法清單】；若未採用固定算法，亦需說明理由。"
    : "";

  const userBlock = [
    `name: ${name || "（空）"}`,
    mother ? `mother_name: ${mother}` : null,
    birth ? `birth: ${birth}` : null,
    `question: ${question}`,
    ctrlLine
  ].filter(Boolean).join("\n");

  const pre  = (b._admin?.pre_template  ?? process.env.PRE_TEMPLATE  ?? "").trim();
  const post = (b._admin?.post_template ?? process.env.POST_TEMPLATE ?? "").trim();
  const tail = (b._admin?.safety_tail   ?? process.env.SAFETY_TAIL   ?? "").trim();

  // 依 server gate 插入模式提示
  const modeLine = req._mode === "composite"
    ? "※ 會員模式：允許動用並融合 27 條公式，輸出完整報告與高清分享卡。"
    : "※ 訪客模式：僅允許單一公式（入口算法），請輸出精簡摘要。";

  const content = [pre, "", "# 使用者輸入", userBlock, modeLine, "", post].filter(Boolean).join("\n");
  return { content, tail };
}

function pickModel(b) {
  return (b?._admin?.model || b?.model || process.env.OPENAI_MODEL || "gpt-5").trim();
}

// ---- 非流式：Responses（GPT-5 → reasoning/text high）
export default async function askHandler(req, res) {
  const t0 = Date.now();

  // 離線假回覆（開關：FAKE_ASK=1）
  if (process.env.FAKE_ASK === "1") {
    const answer = `【離線測試回覆】模式=${req._mode} 問題=${(req.body?.q||"")}`;
    return res.json({ ok:true, used_model:"fake", elapsed_ms:1, answer, sys_hash:"-", sys_len:0 });
  }

  try {
    const b = req.body || {};
    const prompt = buildPrompt(req);
    if (prompt.err) return res.status(400).json({ ok:false, error:"missing_field", message:prompt.err });

    const model     = pickModel(b);
    const maxTokens = Number(b._admin?.max_output_tokens ?? process.env.MAX_TOKENS ?? 8000);
    const isGpt5    = /^gpt-5($|-)/i.test(model);

    const resp = await getClient().responses.create({
      model,
      input: [
        { role: "system", content: SYSTEM_TEXT },
        { role: "user",   content: prompt.content }
      ],
      max_output_tokens: maxTokens,
      ...(isGpt5
        ? { reasoning: { effort: "high" }, text: { verbosity: "high" } }
        : { temperature: (b._admin?.temperature ?? null) === null ? undefined : Number(b._admin?.temperature) }),
    });

    const text   = (resp?.output_text || "").trim();
    const answer = (text || "（沒有產出文字）") + (prompt.tail ? `\n\n${prompt.tail}` : "");
    const meta   = { sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length };

    res.json({ ok:true, used_model:model, elapsed_ms: Date.now() - t0, answer, ...meta });

  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[askHandler] error:", msg);

    if (msg.includes("429")) {
      return res.status(200).json({
        ok:false,
        error:"quota_exceeded",
        answer:"⚠️ 系統忙碌：請通知管理員維護，目前線路壅塞。請截圖保障您的付費權益。",
        detail: msg,
        sys_hash: sha1(SYSTEM_TEXT),
        sys_len: SYSTEM_TEXT.length
      });
    }
    res.status(500).json({ ok:false, error:"server_error", detail: msg, answer:"", sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length });
  }
}

// ---- 真·流式：Responses 原生串流 + GPT-5 high（失敗時回退一次非流式）
export async function streamAsk(req, res) {
  const t0 = Date.now();
  const write = (event, data) => res.write(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`);

  try {
    const b = req.body || {};
    const prompt = buildPrompt(req);
    if (prompt.err) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      write("final", { ok:false, error:"missing_field", message:prompt.err, sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length });
      return res.end();
    }

    const model     = pickModel(b);
    const maxTokens = Number(b._admin?.max_output_tokens ?? process.env.MAX_TOKENS ?? 8000);

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    write("progress", { stage: "received", ts: Date.now() });
    const hb = setInterval(() => res.write(": ping\n\n"), 15000);

    const stream = await getClient().responses.stream({
      model,
      input: [
        { role: "system", content: SYSTEM_TEXT },
        { role: "user",   content: prompt.content }
      ],
      reasoning: { effort: "high" },
      text: { verbosity: "high" },
      max_output_tokens: maxTokens
    });

    let full = "";
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const delta = event.delta || "";
        if (delta) { full += delta; write("delta", { delta }); }
      } else if (event.type === "response.error") {
        write("final", {
          ok:false, error:"server_error",
          detail: event.error?.message || "responses stream error",
          answer:"", sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length
        });
        clearInterval(hb);
        return res.end();
      }
    }

    await stream.finalResponse().catch(() => null);

    const answer = (full.trim() || "（沒有產出文字）") + (prompt.tail ? `\n\n${prompt.tail}` : "");
    write("final", {
      ok:true, used_model:model, elapsed_ms: Date.now() - t0,
      answer, sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length
    });

    clearInterval(hb);
    res.end();

  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[streamAsk.responses] error:", msg);

    if (msg.includes("429")) {
      write("final", {
        ok:false, error:"quota_exceeded", detail: msg,
        answer:"⚠️ 系統忙碌：請通知管理員維護，目前線路壅塞。請截圖保障您的付費權益。",
        sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length
      });
      return res.end();
    }

    // 回退一次非流式
    try {
      const model     = pickModel(req.body || {});
      const maxTokens = Number(req.body?._admin?.max_output_tokens ?? process.env.MAX_TOKENS ?? 8000);

      const r = await getClient().responses.create({
        model,
        input: [
          { role: "system", content: SYSTEM_TEXT },
          { role: "user",   content: buildPrompt(req).content }
        ],
        reasoning: { effort: "high" },
        text: { verbosity: "high" },
        max_output_tokens: maxTokens
      });

      const text   = (r?.output_text || "").trim();
      const answer = (text || "（沒有產出文字）") + (buildPrompt(req).tail ? `\n\n${buildPrompt(req).tail}` : "");
      write("final", {
        ok:true, used_model:model, elapsed_ms: Date.now() - t0,
        answer, sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length
      });
      return res.end();

    } catch (e2) {
      write("final", { ok:false, error:"server_error", detail:String(e2?.message||e2), answer:"", sys_hash: sha1(SYSTEM_TEXT), sys_len: SYSTEM_TEXT.length });
      return res.end();
    }
  }
}
