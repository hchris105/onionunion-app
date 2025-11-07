// scripts/import_handles_whitelist.js
import fs from "fs";
import mongoose from "mongoose";
import User from "../models/User.js"; // 只需確保此 model 會把 users 指到 onionunion.users

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/onionunion";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(file) {
  await mongoose.connect(MONGO_URL);

  const raw = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let created = 0, updated = 0, skipped = 0, bad = 0;

  for (let line of raw) {
    // 1) 去全形空白、trim
    if (!line) { skipped++; continue; }
    line = line.replace(/\u3000/g, " ").trim();
    if (!line) { skipped++; continue; }

    const handle = line;

    try {
      // 2) upsert：只在插入時設定 handle / preorder；永遠清掉 email/password_hash
      const res = await User.updateOne(
        { handle: new RegExp(`^${escapeRegex(handle)}$`, "i") },
        {
          $setOnInsert: { handle, preorder: true, role: "visitor" },
          $unset: { email: "", password_hash: "" }   // ← 關鍵：不要留 null，直接移除欄位
        },
        { upsert: true, collation: { locale: "en", strength: 2 } }
      );

      if (res.upsertedCount) created++;
      else if (res.modifiedCount) updated++;
      else skipped++; // 已存在且無需變更
    } catch (e) {
      bad++;
      console.log(`[import][error] "${handle}" ->`, e?.message || e);
    }
  }

  console.log("IMPORT DONE {");
  console.log(`  created: ${created},`);
  console.log(`  updated: ${updated},`);
  console.log(`  skipped: ${skipped},`);
  console.log(`  bad: ${bad},`);
  console.log(`  file: '${file}'`);
  console.log("}");

  await mongoose.disconnect();
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import_handles_whitelist.js <file>");
  process.exit(1);
}
main(file).catch(err => {
  console.error(err);
  process.exit(1);
});
