import { Router } from "express";
// OpenAI 改成 Gemini 3 Pro
// import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import User from "../models/User.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Gemini client ----------
if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "[ask] GEMINI_API_KEY 未設定，呼叫 Gemini 3 Pro 會失敗，請檢查 .env"
  );
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ---------- small helpers ----------
function sha1(str) {
  return crypto.createHash("sha1").update(str || "", "utf8").digest("hex");
}

/**
 * Trial 優惠次數狀態：
 * - TRIAL_ASK_LIMIT（預設 3）為「優惠價上限次數」
 * - 第 1 ~ limit 次：tier = trial_discount
 * - 之後：tier = trial_full
 */
function getTrialQuota(user) {
  const defaultLimit = Number(process.env.TRIAL_ASK_LIMIT ?? 3);
  const limit =
    typeof user.trial_ask_limit === "number" &&
    user.trial_ask_limit > 0 &&
    user.trial_ask_limit < 99
      ? user.trial_ask_limit
      : defaultLimit;
  const used = Number(user.trial_ask_used ?? 0) || 0;

  const remaining = Math.max(0, limit - used);
  const discountEligible = used < limit;
  const tier = discountEligible ? "trial_discount" : "trial_full";

  return {
    limit,
    used,
    remaining,
    discountEligible,
    tier,
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
    // 🔺 新規則：Trial 不會被擋，只是有「優惠價前 3 次」的差異
    const quota = getTrialQuota(user);
    return {
      ok: true,
      httpStatus: 200,
      code: "ok_trial",
      trial: quota,
    };
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
const TRIAL_PATH = path.join(PROMPT_DIR, "trial-default.md"); // 暫時不再使用，但先保留路徑

const promptCache = {
  super: { text: "", mtime: 0 },
  trial: { text: "", mtime: 0 },
};

function loadPrompt(kind) {
  // 🔺 新規則：trial 也使用 superprompt，不再實際載入 trial-default
  const filePath = SUPER_PATH;
  const cache = promptCache.super;

  try {
    const stat = fs.statSync(filePath);
    if (!cache.mtime || cache.mtime !== stat.mtimeMs) {
      cache.text = fs.readFileSync(filePath, "utf8");
      cache.mtime = stat.mtimeMs;
      console.log(
        `[System] super prompt reloaded:`,
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
      console.log("[System] super prompt missing, using fallback.");
    } else {
      console.error("[System] reload super prompt failed:", err.message || err);
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

// ---------- Gemini model picker ----------
function pickModel(b) {
  const fromBody = (b?._admin?.model || b?.model || "").trim();
  if (fromBody) return fromBody;
  return (
    process.env.GEMINI_MODEL_SUPER ||
    "gemini-3-pro-preview" // 官方 model code
  );
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

    // 🔺 trial & active 都使用 superprompt
    const systemPrompt = loadPrompt("super");
    const model = pickModel(req.body || {});

    // Trial / Active 完全同規格，不再分 token 上限
    const maxTokens =
      Number(
        (req.body?._admin?.max_output_tokens) ?? process.env.MAX_TOKENS
      ) || 8000;

    // --- 呼叫 Gemini 3 Pro ---
    const reqConfig = {
      model,
      contents: prompt.content, // 使用者輸入（含姓名/生日/母名/問題）
      config: {
        systemInstruction: systemPrompt, // superprompt 當系統指令
        maxOutputTokens: maxTokens,
        temperature: 0.7,
      },
    };

    let resp;
    try {
      resp = await ai.models.generateContent(reqConfig);
    } catch (err) {
      const msg = String(err?.message || err);
      console.error("[ask] Gemini generateContent error:", msg);
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
        error: "llm_error",
        detail: msg,
      });
    }

    const usedModel = model;
    const usage = resp.usageMetadata || null; // token 使用量（如果 SDK 有提供）

    // ===== DEBUG 模式：直接回傳 raw responses 方便排錯 =====
    if (req.body && req.body._debug_raw) {
      try {
        console.log(
          "[DEBUG] /ask raw Gemini response:",
          JSON.stringify(resp, null, 2).slice(0, 4000)
        );
      } catch (e) {
        console.log(
          "[DEBUG] /ask raw Gemini response (toJSON failed)",
          String(e)
        );
      }

      return res.json({
        ok: true,
        debug: true,
        used_model: usedModel,
        raw: resp,
      });
    }
    // ===== END DEBUG =====

    let answer = (resp.text || "").trim(); // 官方 SDK 會聚合到 text
    if (!answer) {
      const dump = JSON.stringify(resp, null, 2).slice(0, 1200);
      answer =
        "（解析 Gemini 回覆時發生問題，下列為原始輸出片段，供開發者除錯）\n\n" +
        dump;
    }

    if (prompt.tail) answer += `\n\n${prompt.tail}`;

    // ---------- Trial 優惠次數統計 & 計價層級 ----------
    let billing = {
      tier: "active",
    };

    if (isTrial) {
      const quotaBefore = getTrialQuota(user); // 使用前的狀態
      const nextUsed = quotaBefore.used + 1;

      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              trial_ask_limit: quotaBefore.limit,
              trial_ask_used: nextUsed,
            },
          }
        );
      } catch (err) {
        console.error("[ask] update trial usage error:", err);
      }

      billing = {
        tier: quotaBefore.tier, // trial_discount / trial_full
        trial: {
          limit: quotaBefore.limit,
          used: nextUsed,
          remaining: Math.max(0, quotaBefore.limit - nextUsed),
        },
      };
    } else if (user.status === "active" || user.status === "member") {
      billing = {
        tier: "active",
      };
    }

    return res.json({
      ok: true,
      used_model: usedModel,
      status: user.status,
      elapsed_ms: Date.now() - t0,
      answer,
      sys_kind: "super", // 無論 trial/active 都是 superprompt
      sys_hash: sha1(systemPrompt),
      sys_len: systemPrompt.length,
      billing,
      usage,
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
// 目前尚未實作 Gemini 流式輸出，暫時回 501，請前端改用非流式 /ask。
router.post("/stream", async (req, res) => {
  return res.status(501).json({
    ok: false,
    error: "stream_not_implemented",
    message: "暫未開放流式輸出，請改用一般 /ask。",
  });
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
