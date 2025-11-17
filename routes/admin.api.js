// routes/admin.api.js
import { Router } from "express";
import db from "../services/db.js";
import charactersService from "../services/characters.js";

const router = Router();
const { mongoose } = db;

// ========== 共用工具 ==========

function requireAdmin(req, res, next) {
  if (process.env.DISABLE_ADMIN === "1") {
    return res.status(403).json({
      ok: false,
      error: "admin_disabled",
      message: "管理介面已關閉（DISABLE_ADMIN=1）",
    });
  }

  const expected = process.env.ADMIN_TOKEN || "";
  const token = req.get("X-Admin-Token") || req.query.token;

  if (!expected) {
    return res.status(500).json({
      ok: false,
      error: "admin_token_missing",
      message: "尚未在 .env 設定 ADMIN_TOKEN",
    });
  }

  if (token !== expected) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "缺少或錯誤的 X-Admin-Token",
    });
  }

  next();
}

function parseDateSafe(val, def) {
  if (!val) return def;
  const d = new Date(val);
  return isNaN(d.getTime()) ? def : d;
}

function toCsvField(v) {
  if (v === null || v === undefined) return '""';
  const s = v instanceof Date ? v.toISOString() : String(v);
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

// ========== 1) GET /admin/api/usage ==========
//
// 查 token 用量；支援 JSON / CSV 匯出
router.get("/api/usage", requireAdmin, async (req, res) => {
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1) {
      return res.status(500).json({ ok: false, error: "db_not_connected" });
    }

    const col = conn.collection("usage");

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const from = parseDateSafe(req.query.from, sevenDaysAgo);
    const to = parseDateSafe(req.query.to, now);
    const handle = req.query.handle || null;
    const format = (req.query.format || "json").toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 2000, 10000);

    const query = { ts: { $gte: from, $lte: to } };
    if (handle) query.handle = handle;

    const docs = await col
      .find(query)
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();

    let totalInput = 0;
    let totalOutput = 0;
    for (const d of docs) {
      totalInput += Number(d.input_tokens || 0);
      totalOutput += Number(d.output_tokens || 0);
    }

    if (format === "csv") {
      const headers = [
        "ts",
        "handle",
        "route",
        "model",
        "input_tokens",
        "output_tokens",
        "elapsed_ms",
        "status",
        "error",
      ];
      const lines = [headers.join(",")];

      for (const d of docs) {
        const row = [
          toCsvField(d.ts),
          toCsvField(d.handle || ""),
          toCsvField(d.route || ""),
          toCsvField(d.model || ""),
          toCsvField(d.input_tokens || 0),
          toCsvField(d.output_tokens || 0),
          toCsvField(d.elapsed_ms || 0),
          toCsvField(d.status || ""),
          toCsvField(d.error || ""),
        ];
        lines.push(row.join(","));
      }

      const filename = `usage-${from
        .toISOString()
        .slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      return res.send(lines.join("\n"));
    }

    return res.json({
      ok: true,
      from: from.toISOString(),
      to: to.toISOString(),
      handle,
      limit,
      count: docs.length,
      total_calls: docs.length,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      items: docs,
    });
  } catch (err) {
    console.error("[admin.api/usage] error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err?.message || String(err),
    });
  }
});

// ========== 2) POST /admin/api/characters/import ==========
//
// 匯入 500 角色設定；支援 replace / upsert 模式
//
// Body：{
//   "mode": "replace" | "upsert",
//   "items": [
//     { "code": "T001", "name": "...", "line": "淚系", "tags": [...], "rarity": "R", "note": "..." },
//     ...
//   ]
// }
router.post("/api/characters/import", requireAdmin, async (req, res) => {
  console.log("[admin.api] /characters/import hit");
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1) {
      return res.status(500).json({ ok: false, error: "db_not_connected" });
    }

    const col = conn.collection("characters");
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const mode = body.mode === "replace" ? "replace" : "upsert";

    console.log(
      "[admin.api] characters/import",
      "mode=",
      mode,
      "rawItems=",
      items.length
    );

    if (!items.length) {
      return res.status(400).json({
        ok: false,
        error: "empty_items",
        message: "body.items 必須是非空陣列",
      });
    }

    const docs = [];
    for (const raw of items) {
      if (!raw) continue;
      const code = String(raw.code || "").trim();
      if (!code) continue;

      const doc = {
        code,
        name: raw.name || "",
        line: raw.line || "",
        tags: Array.isArray(raw.tags)
          ? raw.tags.map((x) => String(x))
          : [],
        rarity: raw.rarity || null,
        note: raw.note || "",
        meta: raw.meta || {},
        assigned_handle: raw.assigned_handle || null,
        assigned_at: raw.assigned_at ? new Date(raw.assigned_at) : null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      docs.push(doc);
    }

    console.log("[admin.api] characters/import validDocs=", docs.length);

    if (!docs.length) {
      return res.status(400).json({
        ok: false,
        error: "no_valid_docs",
        message: "items 中沒有有效的 code",
      });
    }

    let result;
    if (mode === "replace") {
      console.log("[admin.api] characters/import: deleteMany + insertMany");
      await col.deleteMany({});
      result = await col.insertMany(docs, { ordered: true });
      return res.json({
        ok: true,
        mode,
        inserted: docs.length,
      });
    } else {
      console.log("[admin.api] characters/import: bulkWrite upsert");
      const ops = docs.map((d) => ({
        updateOne: {
          filter: { code: d.code },
          update: {
            $set: {
              name: d.name,
              line: d.line,
              tags: d.tags,
              rarity: d.rarity,
              note: d.note,
              meta: d.meta,
              updated_at: new Date(),
            },
            $setOnInsert: {
              assigned_handle: d.assigned_handle || null,
              assigned_at: d.assigned_at || null,
              created_at: new Date(),
            },
          },
          upsert: true,
        },
      }));
      result = await col.bulkWrite(ops, { ordered: false });

      return res.json({
        ok: true,
        mode,
        matched: result.matchedCount,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
      });
    }
  } catch (err) {
    console.error("[admin.api/characters.import] error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err?.message || String(err),
    });
  }
});

// ========== 3) POST /admin/api/grant-random ==========
//
// 從 characters 裡找一個尚未分配的角色，分配給指定 handle。
// Body：{ "handle": "某人帳號", "kind": "preorder500" }
router.post("/api/grant-random", requireAdmin, async (req, res) => {
  try {
    const handle = String(req.body?.handle || "").trim();
    const kind = String(req.body?.kind || "preorder500").trim();

    if (!handle) {
      return res.status(400).json({
        ok: false,
        error: "missing_handle",
        message: "body.handle 必填",
      });
    }

    const result = await charactersService.grantRandomCharacter(handle, kind);

    if (result.noAvailable) {
      return res.status(404).json({
        ok: false,
        error: "no_available_character",
        message: "沒有可用的未分配角色了",
      });
    }

    const c = result.character || null;

    return res.json({
      ok: true,
      handle,
      kind,
      character: c
        ? {
            code: c.code,
            name: c.name,
            line: c.line,
            tags: c.tags,
            rarity: c.rarity,
            note: c.note,
          }
        : null,
      draw_id: result.drawId || null,
      already_had_draw: !!result.alreadyHad,
    });
  } catch (err) {
    console.error("[admin.api/grant-random] error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err?.message || String(err),
    });
  }
});

export default router;
