// scripts/import_preorders_from_csv.js
// 匯入預約名單（預設讀 ./data/cyperhandle.csv），建立/更新 preorder 使用者
// Node ESM

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { parse } from "csv-parse/sync";
import User from "../models/User.js";

dotenv.config();

// 1) CSV 路徑：優先取 CLI 參數，其次取環境變數 CSV_FILE，否則用 ./data/cyperhandle.csv
const csvPath =
  process.argv[2] ||
  process.env.CSV_FILE ||
  "./data/cyperhandle.csv";

const abs = path.resolve(csvPath);
if (!fs.existsSync(abs)) {
  console.error("[ERR] CSV not found:", abs);
  process.exit(1);
}

// 2) 連線 MongoDB
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
await mongoose.connect(MONGODB_URI, { dbName: "onionunion" });
console.log("[DB] connected");

// 3) 讀檔（自動移除 UTF-8 BOM；若不是 UTF-8 仍會顯亂碼，這種情況才需要另行轉碼）
let text = fs.readFileSync(abs, "utf-8");
// 去除可能存在的 BOM
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

// 4) 解析 CSV（寬容：自動跳過空白行、兩側空白；欄位名保留原樣以便做中英對照）
const rows = parse(text, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

// 5) 欄位抽取（中英/繁簡兼容）
function pick(row, ...names) {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

// 6) 主流程：建立/保留 preorder 使用者；不覆寫已存在帳號
let imported = 0;
let skipped = 0;

for (const row of rows) {
  // 你 CSV 可能的欄位別名（自行再加）：
  // handle：洋葱联盟账号 / 洋蔥聯盟帳號 / OnionUnion帳號 / handle
  // wechat：微信号 / 微信號 / wechat / 微信
  const handleRaw = pick(
    row,
    "洋葱联盟账号",
    "洋蔥聯盟帳號",
    "OnionUnion帳號",
    "handle",
    "账号",
    "帳號"
  );
  const wechatRaw = pick(row, "微信号", "微信號", "wechat", "微信");

  if (!handleRaw) {
    skipped++;
    continue;
  }

  const handle = String(handleRaw).toLowerCase();
  const wechat = wechatRaw || null;

  const doc = {
    handle,
    wechat_id: wechat,
    status: "preorder",          // 預約階段，尚未認領
    password_hash: null,         // 未設定密碼
    must_reset_password: false,  // 首登可要求改密（之後要就再打開）
    roles: ["member"],           // 先給 member；之後根據你的抽籤/職階再升級
  };

  // upsert，但**不覆寫**已存在的帳號（避免清掉既有密碼/狀態）
  await User.updateOne(
    { handle },
    { $setOnInsert: doc },
    { upsert: true }
  );

  imported++;
}

console.log(`[OK] Imported/ensured ${imported} rows, skipped ${skipped}.`);
await mongoose.disconnect();
console.log("[DB] disconnected");
