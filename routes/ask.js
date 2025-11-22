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

// ---------- OpenAI client ----------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID || undefined,
});

// ---------- small helpers ----------
function sha1(str) {
  return crypto.createHash("sha1").update(str || "", "utf8").digest("hex");
}

function getTrialQuota(user) {
  const defaultLimit = Number(process.env.TRIAL_ASK_LIMIT ?? 3);
  const limit =
    typeof user.trial_ask_limit === "number" &&
    user.trial_ask_limit > 0 &&
    user.trial_ask_limit < 99
      ? user.trial_ask_limit
      : defaultLimit;
  const used = Number(user.trial_ask_used ?? 0) || 0;
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
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
      code: "account_blocked",
      message: "此帳號目前無法使用測算服務，如有疑問請聯繫管理員。",
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
    code: "status_unknown",
    message: `帳號狀態異常（${status}），請聯繫管理員確認。`,
  };
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
        `[System] ${isTrial ? "trial" : "super"} prompt missing, using fallback.`
      );
    } else {
      console.error(
        `[System] reload ${isTrial ? "trial" : "super"} prompt failed:`,
        err.message || err
      );
    }
  }
  return cache.text;
}

// ---------- buildPrompt ----------
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

// ---------- 判斷是不是像 rs_xxx 的技術 ID ----------
function isProbablyIdString(s) {
  if (!s) return false;
  if (typeof s !== "string") return false;
  const str = s.trim();
  if (!str) return false;

  // 典型 run-step / response ID：以 rs_ 開頭 + 一長串 hex
  if (/^rs_[0-9a-f]{16,}$/i.test(str)) return true;

  // 很長、幾乎全是 [0-9a-z_-]，沒有空白，也很可疑
  if (
    str.length >= 24 &&
    /^[0-9a-zA-Z\-_]+$/.test(str) &&
    !/\s/.test(str)
  ) {
    return true;
  }

  return false;
}

// ---------- 專門解析 Responses API 的輸出 ----------
function extractTextFromResponses(resp) {
  if (!resp) return "";

  const collected = [];

  // 1) 官方建議：output_text[*].content[*].text.value
  if (Array.isArray(resp.output_text)) {
    for (const block of resp.output_text) {
      if (!block || !Array.isArray(block.content)) continue;
      for (const part of block.content) {
        if (!part) continue;
        if (part.type === "output_text" && part.text) {
          const t = part.text;
          if (typeof t === "string") {
            const s = t.trim();
            if (s) collected.push(s);
          } else if (typeof t.value === "string") {
            const s = t.value.trim();
            if (s) collected.push(s);
          }
        }
      }
    }
  }

  // 2) 備援：output[*].content[*].text.value
  if (!collected.length && Array.isArray(resp.output)) {
    for (const item of resp.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!part) continue;
        if (part.type === "output_text" && part.text) {
          const t = part.text;
          if (typeof t === "string") {
            const s = t.trim();
            if (s) collected.push(s);
          } else if (typeof t.value === "string") {
            const s = t.value.trim();
            if (s) collected.push(s);
          }
        }
      }
    }
  }

  // 3) 最後保險：把 resp.output_text || resp.output || resp 整個掃一遍
  if (!collected.length) {
    let data = resp.output_text || resp.output || resp;
    try {
      data = JSON.parse(JSON.stringify(data));
    } catch (e) {
      console.error("[extractText] JSON clone error:", e);
    }

    const tmp = [];
    function walk(node) {
      if (node == null) return;
      if (typeof node === "string") {
        const s = node.trim();
        if (s.length >= 3) tmp.push(s);
        return;
      }
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (typeof node === "object") {
        for (const v of Object.values(node)) walk(v);
      }
    }

    try {
      walk(data);
    } catch (e) {
      console.error("[extractText] walk error:", e);
    }

    collected.push(...tmp);
  }

  if (!collected.length) return "";

  // 先去掉看起來像 ID 的字串
  const filtered = [];
  const seenRaw = new Set();
  for (const raw of collected) {
    const s = String(raw).trim();
    if (!s || seenRaw.has(s)) continue;
    seenRaw.add(s);
    if (isProbablyIdString(s)) continue; // 忽略 rs_xxx 之類
    filtered.push(s);
  }

  if (!filtered.length) {
    // 如果全部像 ID，只好退回原始 collected
    filtered.push(...seenRaw);
  }

  // 再次去重 + 分級：優先含非 ASCII（阿拉伯＋中文）
  const seen = new Set();
  const primary = [];
  const fallback = [];
  for (const raw of filtered) {
    const s = String(raw).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (/[^\x00-\x7F]/.test(s) && s.length >= 10) {
      primary.push(s);
    } else if (s.length >= 10) {
      fallback.push(s);
    }
  }

  if (primary.length) return primary.join("\n\n");
  if (fallback.length) return fallback.join("\n\n");

  // 都太短就全部串起來
  return Array.from(seen).join("\n\n");
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

    const resp = await client.responses.create(params);
    const usedModel = resp.model || model;

    // ===== DEBUG 模式：直接回傳 raw responses 方便排錯 =====
    if (req.body && req.body._debug_raw) {
      try {
        console.log(
          "[DEBUG] /ask raw responses:",
          JSON.stringify(resp, null, 2).slice(0, 4000)
        );
      } catch (e) {
        console.log("[DEBUG] /ask raw responses (toJSON failed)", String(e));
      }

      return res.json({
        ok: true,
        debug: true,
        used_model: usedModel,
        raw: resp,
      });
    }
    // ===== END DEBUG =====

    let answer = extractTextFromResponses(resp).trim();
    if (!answer) {
      const dump = JSON.stringify(
        resp.output_text || resp.output || resp,
        null,
        2
      ).slice(0, 1200);
      answer =
        "（解析回覆時發生問題，下列為系統原始輸出片段，供開發者除錯）\n\n" +
        dump;
    }

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
        console.error("[ask] update trial quota error:", err);
      }
    }

    return res.json({
      ok: true,
      used_model: usedModel,
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

// ---------- /ask/stream（暫時保留 Responses 流式） ----------
router.post("/stream", async (req, res) => {
  const t0 = Date.now();
  function write(event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const user = await getUserFromReq(req);
    const gate = ensureAskAllowed(user);
    if (!gate.ok) {
      write("final", {
        ok: false,
        code: gate.code,
        message: gate.message,
        ...(gate.trial ? { trial: gate.trial } : {}),
      });
      return res.end();
    }
    req.user = user;

    const prompt = buildPrompt(req);
    if (prompt.err) {
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

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const heartbeat = setInterval(() => {
      write("heartbeat", { ts: Date.now() });
    }, 15000);

    const params = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.content },
      ],
      max_output_tokens: maxTokens,
    };

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

    let answerText = full.trim();
    if (!answerText) {
      answerText =
        "（流式輸出為空，請稍後重試或通知管理員除錯。）";
    }
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
        console.error("[ask/stream] update trial quota error:", err);
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
        answer:
          "⚠️ 系統忙碌：請通知管理員維護，目前線路壅塞。",
        detail: msg,
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

export default router;
