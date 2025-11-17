// services/characters.js
import db from "./db.js";

const { mongoose } = db;

/**
 * 給指定 handle 抽一個隨機角色（同一個 kind 只會抽到一次）
 *
 * @param {string} handle - 使用者 handle（必填）
 * @param {string} kind   - 抽獎類型（預設 "preorder500"）
 *
 * 回傳物件：
 * - { alreadyHad: true,  character, drawId }   // 之前抽過，直接回原本那隻
 * - { alreadyHad: false, character, drawId }   // 第一次抽到
 * - { noAvailable: true }                      // 沒有可用角色
 */
export async function grantRandomCharacter(handle, kind = "preorder500") {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1) {
    throw new Error("db_not_connected");
  }

  handle = String(handle || "").trim();
  kind = String(kind || "preorder500").trim();

  if (!handle) {
    throw new Error("missing_handle");
  }

  const colChars = conn.collection("characters");
  const colDraws = conn.collection("roledraws");
  const colUsers = conn.collection("users");

  // 1) 先看這個 handle 之前有沒有抽過（同一種 kind）
  const existingDraw = await colDraws.findOne({ handle, kind });

  if (existingDraw) {
    const existingChar = await colChars.findOne({
      code: existingDraw.character_code,
    });

    return {
      alreadyHad: true,
      drawId: existingDraw._id,
      character: existingChar || null,
    };
  }

  // 2) 還沒抽過：從尚未分配的角色中隨機挑一隻
  const available = await colChars
    .find(
      {
        $or: [{ assigned_handle: null }, { assigned_handle: "" }],
      },
      { projection: { code: 1 } }
    )
    .toArray();

  if (!available.length) {
    return { noAvailable: true };
  }

  const pick = available[Math.floor(Math.random() * available.length)];

  // 用 code + 未分配條件來鎖定，避免同時被兩個人搶到
  const updated = await colChars.findOneAndUpdate(
    {
      code: pick.code,
      $or: [{ assigned_handle: null }, { assigned_handle: "" }],
    },
    {
      $set: {
        assigned_handle: handle,
        assigned_at: new Date(),
        assigned_kind: kind,
      },
    },
    {
      returnDocument: "after",
    }
  );

  if (!updated) {
    // 極少數競態：被別人搶走了 → 當作沒有可用角色
    return { noAvailable: true };
  }

  const chosen = updated;

  // 寫入抽卡紀錄
  const drawDoc = {
    ts: new Date(),
    handle,
    kind,
    character_code: chosen.code,
    character_id: chosen._id,
  };
  const ins = await colDraws.insertOne(drawDoc);

  // 同步寫回 users，方便前台 / 管理介面查詢
  await colUsers.updateOne(
    { handle },
    {
      $set: {
        character_code: chosen.code,
        character_name: chosen.name || null,
        character_line: chosen.line || null,
        character_assigned_at: chosen.assigned_at || new Date(),
      },
    }
  );

  return {
    alreadyHad: false,
    drawId: ins.insertedId,
    character: chosen,
  };
}

export default {
  grantRandomCharacter,
};
