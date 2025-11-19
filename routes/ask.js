// backend/routes/ask.js
import { Router } from "express";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import User from "../models/User.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- OpenAI client：懶載入，缺 KEY 不會讓服務掛掉 ----------
let client = null;

function getOpenAIClient() {
  if (client) return client;

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error(
      "[ask] OPENAI_API_KEY is missing; /ask will return 503 until it is set."
    );
    return null;
  }

  client = new OpenAI({
    apiKey: key,
    organization: process.env.OPENAI_ORG_ID || undefined,
  });
  return client;
}

// ---------- small helpers ----------
function sha1(str) {
  return crypto.createHash("sha1").update(str || "", "utf8").digest("hex");
}

function getTrialQuota(user) {
  const defaultLimit = Number(process.env.TRIAL_ASK_LIMIT ?? 3);
  const limit =
    typeof user.trial_ask_limit === "number" && user.trial_ask_limit > 0
      ? user.trial_ask_limit
      : defaultLimit;
  const used =
    typeof user.trial_ask_used === "number" && user.trial_ask_used >= 0
      ? user.trial_ask_used
      : 0;
  return { limit, used, remaining: Math.max(0, limit - used) };
}

function ensureAskAllowed(user) {
  if (!user) {
    return {
      ok: false,
      httpStatus: 401,
      code: "unauthorized",
      message: "請先登入會員帳號再使用此服務。",
    };
  }

  const status = user.status || "preorder";

  if (["refunded", "disabled", "locked"].includes(status)) {
    return {
      ok: false,
      httpStatus: 403,
      code: "account_inactive",
      message: "帳號已停用或封鎖，如有疑問請聯繫管理員。",
    };
  }

  if (status === "preorder") {
    return {
      ok: false,
      httpStatus: 403,
      code: "preorder_cannot_ask",
      message: "預約帳號目前僅能抽角色，不能直接使用測算服務。",
    };
  }

  if (status === "trial") {
    const quota = getTrialQuota(user);
    if (quota.remaining <= 0) {
      return {
        ok: false,
        httpStatus: 403,
        code: "trial_quota_exhausted",
        message: `試用次數已用完（${quota.used}/${quota.limit}），如需繼續使用請依 Trial 規則付費。`,
        trial: quota,
      };
    }
    return { ok: true, httpStatus: 200, code: "ok_trial", trial: quota };
  }

  if (status === "active" || status === "member") {
    return { ok: true, httpStatus: 200, code: "ok" };
  }

  return {
    ok: false,
    httpStatus: 403,
    code: "unknown_status",
    message: "帳號狀態異常，請聯繫管理員。",
  };
}

async function getUserFromReq(req) {
  try {
    if (req.user && req.user._id) return req.user;
    const sid = req.cookies?.sid;
    if (!sid) return null;
    const u = await User.findById(sid).lean();
    return u || null;
  } catch (err) {
    console.error("[ask] getUserFromReq error:", err);
    return null;
  }
}

// ---------- prompt loading ----------
const PROMPT_DIR = path.join(__dirname, "..", "data", "prompts");
const SUPER_PATH = path.join(PROMPT_DIR, "superprompt.md");
const TRIAL_PATH = path.join(PROMPT_DIR, "trial-default.md");

const promptCache = {
  super: { text: "", mtime: 0 },
  trial: { text: "", mtime: 0 },
};

function loadPrompt(kind) {
  const isTrial = kind === "trial";
  const filePath = isTrial ? TRIAL_PATH : SUPER_PATH;
  const cache = promptCache[isTrial ? "trial" : "super"];

  try {
    const stat = fs.statSync(filePath);
    if (!cache.mtime || cache.mtime !== stat.mtimeMs) {
      cache.text = fs.readFileSync(filePath, "utf8");
      cache.mtime = stat.mtimeMs;
      console.log(
        `[System] ${isTrial ? "trial" : "super"} prompt reloaded:`,
        filePath,
        "| len=",
        cache.text.length,
        "| sha1=",
        sha1(cache.text)
      );
    }
  } catch (err) {
    if (!cache.text) {
      cache.text =
        process.env.SYS_PROMPT || "You are OnionUnion assistant (fallback).";
      console.log(
        `[System] ${
          isTrial ? "trial" : "super"
        } prompt missing, fallback len=`,
        cache.text.length,
        "sha1=",
        sha1(cache.text)
      );
    }
  }
  return cache.text;
}

function buildPrompt(req) {
  const b = req.body || {};
  const name = b.name || b.myName || "";
  const mother = b.mother_name || b.myMother || "";
  const birth = b.birth || b.myBirth || "";
  const question = b.question || b.q || "";
  if (!question) return { err: "缺少 question" };

  const ctrlLine =
    (process.env.FORCE_ALGO_TAG ?? "1") !== "0"
      ? "※ 請在回覆開頭（第一段）明確標注本次採用的【主算法#id 與備選算法清單】；若未採用固定算法，亦需說明理由。"
      : "";

  const userBlock = [
    `name: ${name || "（空）"}`,
    mother ? `mother_name: ${mother}` : null,
    birth ? `birth: ${birth}` : null,
    `question: ${question}`,
    ctrlLine,
  ]
    .filter(Boolean)
    .join("\n");

  const pre =
    (b._admin?.pre_template ?? process.env.PRE_TEMPLATE ?? "").trim();
  const post =
    (b._admin?.post_template ?? process.env.POST_TEMPLATE ?? "").trim();
  const tail =
    (b._admin?.safety_tail ?? process.env.SAFETY_TAIL ?? "").trim();

  const content = [pre, "", "# 使用者輸入", userBlock, "", post]
    .filter(Boolean)
    .join("\n");

  return { content, tail };
}

function pickModel(b) {
  return (
    b?._admin?.model ||
    b?.model ||
    process.env.OPENAI_MODEL ||
    "gpt-5.1"
  ).trim();
}

// ---------- extract text ----------
function extractText(resp) {
  if (!resp) return "";

  try {
    if (resp.output_text) {
      const ot = Array.isArray(resp.output_text)
        ? resp.output_text
        : [resp.output_text];

      const parts = [];

      for (const msg of ot) {
        if (!msg) continue;
        const c = msg.content;

        if (typeof c === "string") {
          const s = c.trim();
          if (s) parts.push(s);
          continue;
        }

        if (Array.isArray(c)) {
          for (const seg of c) {
            if (!seg) continue;

            if (typeof seg === "string") {
              const s = seg.trim();
              if (s) parts.push(s);
            } else if (typeof seg.text === "string") {
              const s = seg.text.trim();
              if (s) parts.push(s);
            } else if (
              typeof seg.output_text === "string" &&
              seg.output_text.trim()
            ) {
              parts.push(seg.output_text.trim());
            }
          }
        }
      }

      if (parts.length) {
        return [...new Set(parts)].join("\n\n");
      }
    }
  } catch (e) {
    console.error("[extractText] output_text parse error:", e);
  }

  const chunks = [];

  function walk(node, key) {
    if (node == null) return;
    if (typeof node === "string") {
      const s = node.trim();
      if (
        s.length >= 3 &&
        (key === "text" || key === "value" || key === "content" || key === "output_text")
      ) {
        chunks.push(s);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v, key);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        walk(v, k);
      }
    }
  }

  try {
    walk(resp, "");
  } catch (e) {
    console.error("[extractText] walk error:", e);
  }

  if (chunks.length) {
    return [...new Set(chunks)].join("\n\n");
  }
  return "";
}

// ---------- /ask 非流式 ----------
router.post("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const user = await getUserFromReq(req);
    const gate = ensureAskAllowed(user);
    if (!gate.ok) {
      return res.status(gate.httpStatus || 403).json({
        ok: false,
        code: gate.code,
        message: gate.message,
        ...(gate.trial ? { trial: gate.trial } : {}),
      });
    }
    req.user = user;

    const prompt = buildPrompt(req);
    if (prompt.err) {
      return res.status(400).json({
        ok: false,
        error: "missing_field",
        message: prompt.err,
      });
    }

    const isTrial = user.status === "trial";
    const systemPrompt = loadPrompt(isTrial ? "trial" : "super");
    const model = pickModel(req.body || {});
    const maxTokens =
      Number(
        (req.body?._admin?.max_output_tokens) ??
          (isTrial
            ? process.env.TRIAL_MAX_TOKENS
            : process.env.MAX_TOKENS)
      ) || (isTrial ? 2048 : 8000);

    const params = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.content },
      ],
      max_output_tokens: maxTokens,
    };

    const client = getOpenAIClient();
    if (!client) {
      return res.status(503).json({
        ok: false,
        error: "missing_openai_key",
        message: "系統尚未設定 OPENAI_API_KEY，請通知管理員補上。",
      });
    }

    const resp = await client.responses.create(params);
    let text = extractText(resp).trim();

    if (!text) {
      const dump = JSON.stringify(
        resp.output_text || resp.output || resp,
        null,
        2
      ).slice(0, 1200);
      text =
        "（解析回覆時發生問題，下列為系統原始輸出片段，供開發者除錯）\n\n" +
        dump;
    }

    let answer = text;
    if (prompt.tail) answer += `\n\n${prompt.tail}`;

    if (isTrial) {
      const quota = getTrialQuota(user);
      const nextUsed = Math.min(quota.used + 1, quota.limit);
      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              trial_ask_limit: quota.limit,
              trial_ask_used: nextUsed,
            },
          }
        );
      } catch (err) {
        console.error("[ask] update trial usage error:", err);
      }
    }

    return res.json({
      ok: true,
      used_model: model,
      status: user.status,
      elapsed_ms: Date.now() - t0,
      answer,
      sys_kind: isTrial ? "trial" : "super",
      sys_hash: sha1(systemPrompt),
      sys_len: systemPrompt.length,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    console.error("[ask] / error:", msg);
    if (msg.includes("429")) {
      return res.status(200).json({
        ok: false,
        error: "quota_exceeded",
        answer:
          "⚠️ 系統忙碌：請通知管理員維護，目前線路壅塞。請截圖保障您的付費權益。",
        detail: msg,
      });
    }
    return res.status(500).json({
      ok: false,
      error: "server_error",
      detail: msg,
    });
  }
});

// ---------- /ask/stream ----------
router.post("/stream", async (req, res) => {
  const t0 = Date.now();
  const write = (event, data) =>
    res.write(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`);

  try {
    const user = await getUserFromReq(req);
    const gate = ensureAskAllowed(user);
    if (!gate.ok) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      write("final", {
        ok: false,
        code: gate.code,
        message: gate.message,
        ...(gate.trial ? { trial: gate.trial } : {}),
      });
      res.statusCode = gate.httpStatus || 403;
      return res.end();
    }
    req.user = user;

    const prompt = buildPrompt(req);
    if (prompt.err) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      write("final", {
        ok: false,
        error: "missing_field",
        message: prompt.err,
      });
      return res.end();
    }

    const isTrial = user.status === "trial";
    const systemPrompt = loadPrompt(isTrial ? "trial" : "super");
    const model = pickModel(req.body || {});
    const maxTokens =
      Number(
        (req.body?._admin?.max_output_tokens) ??
          (isTrial
            ? process.env.TRIAL_MAX_TOKENS
            : process.env.MAX_TOKENS)
      ) || (isTrial ? 2048 : 8000);

    const params = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.content },
      ],
      max_output_tokens: maxTokens,
    };

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const client = getOpenAIClient();
    if (!client) {
      write("final", {
        ok: false,
        error: "missing_openai_key",
        message: "系統尚未設定 OPENAI_API_KEY，請通知管理員補上。",
      });
      return res.end();
    }

    const heartbeat = setInterval(() => {
      write("heartbeat", { ts: Date.now() });
    }, 15000);

    const stream = await client.responses.stream(params);
    let full = "";

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const delta = event.delta || "";
        if (delta) {
          full += delta;
          write("delta", { delta });
        }
      } else if (event.type === "response.error") {
        write("final", {
          ok: false,
          error: "server_error",
          detail: event.error?.message || "responses stream error",
          answer: "",
        });
        clearInterval(heartbeat);
        return res.end();
      }
    }

    await stream.finalResponse().catch(() => null);

    let answerText = full.trim();
    if (!answerText) {
      const respFinal = await client.responses.create(params);
      answerText = extractText(respFinal).trim();
    }
    if (!answerText) answerText = "（沒有產出文字）";
    if (prompt.tail) answerText += `\n\n${prompt.tail}`;

    if (isTrial) {
      const quota = getTrialQuota(user);
      const nextUsed = Math.min(quota.used + 1, quota.limit);
      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              trial_ask_limit: quota.limit,
              trial_ask_used: nextUsed,
            },
          }
        );
      } catch (err) {
        console.error("[ask/stream] update trial usage error:", err);
      }
    }

    write("final", {
      ok: true,
      used_model: model,
      status: user.status,
      elapsed_ms: Date.now() - t0,
      answer: answerText,
      sys_kind: isTrial ? "trial" : "super",
      sys_hash: sha1(systemPrompt),
      sys_len: systemPrompt.length,
    });

    clearInterval(heartbeat);
    return res.end();
  } catch (err) {
    const msg = String(err?.message || err);
    console.error("[ask/stream] error:", msg);
    if (msg.includes("429")) {
      write("final", {
        ok: false,
        error: "quota_exceeded",
        detail: msg,
        answer:
          "⚠️ 系統忙碌：請通知管理員維護，目前線路壅塞。請截圖保障您的付費權益。",
      });
      return res.end();
    }
    write("final", {
      ok: false,
      error: "server_error",
      detail: msg,
      answer: "",
    });
    return res.end();
  }
});

export default router;
