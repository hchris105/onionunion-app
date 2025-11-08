// scripts/import_preorders_from_csv.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import_preorders_from_csv.js <file.csv>");
  process.exit(1);
}

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error("File not found:", abs);
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
await mongoose.connect(MONGODB_URI);
console.log("[DB] connected");

// 讀入 CSV（簡單逗號切割；若你的檔案有逗號內嵌，之後可改用 csv-parse）
const lines = fs.readFileSync(abs, "utf-8").split(/\r?\n/).filter(Boolean);
const header = lines.shift();
const cols = header.split(",").map(s => s.trim());
const pick = (row, name) => {
  const idx = cols.indexOf(name);
  if (idx === -1) return "";
  const parts = row.split(",");
  return (parts[idx] || "").trim();
};

let ok = 0, skip = 0;
for (const line of lines) {
  const handle = pick(line, "洋葱联盟账号") || pick(line, "洋蔥聯盟帳號") || pick(line, "handle");
  const wechat = pick(line, "微信号") || pick(line, "微信號") || pick(line, "wechat");
  if (!handle) { skip++; continue; }

  const data = {
    handle: String(handle).toLowerCase(),
    wechat_id: wechat || null,
    status: "preorder",
    password_hash: null,
    must_reset_password: false,
  };

  await User.updateOne(
    { handle: data.handle },
    { $setOnInsert: data },
    { upsert: true }
  );
  ok++;
}

console.log(`Imported: ${ok} ok, ${skip} skipped`);
await mongoose.disconnect();
console.log("[DB] disconnected");
