// services/db.js
import mongoose from "mongoose";
import User from "../models/User.js";

// 把環境變數的前後空白去掉，避免 "onionunion " 這種狀況
const uri = (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion").trim();

// 小工具：如果同名索引已存在就略過；沒有就建立
async function createIndexIfMissing(col, spec, options) {
  const wantedName = options?.name;

  let list = [];
  try {
    list = await col.indexes();
  } catch (err) {
    // 在 MongoDB 7，如果 collection 還不存在，indexes() 會報
    // "NamespaceNotFound" / "ns does not exist"，這裡直接當成「目前沒有索引」
    const msg = err?.message || "";
    if (
      err?.codeName === "NamespaceNotFound" ||
      /ns does not exist/i.test(msg)
    ) {
      list = [];
    } else {
      // 其他錯誤就照丟，避免靜默掩蓋
      throw err;
    }
  }

  const has = wantedName && list.some((ix) => ix.name === wantedName);
  if (!has) {
    await col.createIndex(spec, options);
  }
}

export async function initDB() {
  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });

  const conn = mongoose.connection;

  // === users 集合索引 ===
  const users = conn.collection("users");

  await createIndexIfMissing(
    users,
    { handle: 1 },
    { name: "handle_1", unique: true, background: true }
  );

  await createIndexIfMissing(
    users,
    { email: 1 },
    {
      name: "email_1",
      unique: true,
      background: true,
      partialFilterExpression: { email: { $gt: "" } },
    }
  );

  await createIndexIfMissing(
    users,
    { wechat_id: 1 },
    { name: "wechat_1", background: true, sparse: true }
  );

  await createIndexIfMissing(
    users,
    { status: 1 },
    { name: "status_1", background: true }
  );

  await createIndexIfMissing(
    users,
    { roles: 1 },
    { name: "roles_1", background: true }
  );

  // === usage 集合索引（報表用） ===
  const usage = conn.collection("usage");

  await createIndexIfMissing(
    usage,
    { ts: -1 },
    { name: "ts_-1", background: true }
  );

  await createIndexIfMissing(
    usage,
    { handle: 1, ts: -1 },
    { name: "handle_1_ts_-1", background: true }
  );

  await createIndexIfMissing(
    usage,
    { route: 1, ts: -1 },
    { name: "route_1_ts_-1", background: true }
  );

  // === characters：500 角色設定 ===
  const characters = conn.collection("characters");

  await createIndexIfMissing(
    characters,
    { code: 1 },
    { name: "code_1", unique: true, background: true }
  );

  await createIndexIfMissing(
    characters,
    { line: 1 },
    { name: "line_1", background: true }
  );

  await createIndexIfMissing(
    characters,
    { assigned_handle: 1 },
    { name: "assigned_handle_1", background: true }
  );

  // === roledraws：抽卡紀錄 ===
  const roledraws = conn.collection("roledraws");

  await createIndexIfMissing(
    roledraws,
    { handle: 1, ts: -1 },
    { name: "rd_handle_1_ts_-1", background: true }
  );

  await createIndexIfMissing(
    roledraws,
    { character_code: 1 },
    { name: "rd_character_code_1", background: true }
  );

  return conn;
}

export default {
  initDB,
  mongoose,
  User,
};
