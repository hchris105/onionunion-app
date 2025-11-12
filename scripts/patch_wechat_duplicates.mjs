// scripts/patch_wechat_duplicates.mjs
import fs from "fs";

// 讓 models 自己連線（你專案的 models/* 會處理連線）
const { User } = await import("../models/User.js");

// 目標 wechat_id（可改環境變數 DUPS 覆蓋）
const DUPS = (process.env.DUPS || "msz97687,yq149163882")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// CSV 檔路徑，預設 ./cyperhandle.csv
const csvPath = process.argv[2] || "./cyperhandle.csv";

// 讀 CSV
const raw = fs.readFileSync(csvPath, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);
if (lines.length === 0) throw new Error("cyperhandle.csv 內容為空");

const header = lines.shift().split(",");
const hIdx =
  header.findIndex((h) => h.trim() === "洋葱联盟账号") !== -1
    ? header.findIndex((h) => h.trim() === "洋葱联盟账号")
    : header.findIndex((h) => /账号|帳號|account/i.test(h));
const wIdx =
  header.findIndex((h) => h.trim() === "微信号") !== -1
    ? header.findIndex((h) => h.trim() === "微信号")
    : header.findIndex((h) => /wechat|微信/i.test(h));

if (hIdx === -1 || wIdx === -1) {
  throw new Error("CSV 表頭需要有「洋葱联盟账号」與「微信号」（或用 --map 另處理）");
}

// 建立 wechat_id -> handle 對照（只挑重複那兩筆）
const wanted = new Map();
for (const ln of lines) {
  const cols = ln.split(",");
  const w = (cols[wIdx] || "").trim();
  const h = (cols[hIdx] || "").trim();
  if (DUPS.includes(w)) wanted.set(w, h);
}

// 逐筆修補
for (const [w, h] of wanted) {
  const u = await User.findOneAndUpdate(
    { wechat_id: w },
    {
      $set: {
        handle: h,
        status: "preorder",
        roles: ["member"],
        password: w, // 首登以 wechat_id 為初始密碼
        must_reset_password: true,
      },
    },
    { new: true }
  );
  console.log("[patched]", w, "=>", u?.handle || "(not found)");
}

process.exit(0);
