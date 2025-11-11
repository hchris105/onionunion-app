// scripts/import_preorders_from_csv.js — 只插入不存在的預約名單（handle + wechat）
// 預設讀 ./data/cyperhandle.csv（含表頭：handle,wechat）
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import csvParse from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, "../data/cyperhandle.csv");

let User;
try { User = mongoose.model("User"); } catch {
  const userSchema = new mongoose.Schema({
    handle: { type: String, unique: true, index: true },
    wechat_id: { type: String, index: true, sparse: true },
    email: { type: String, index: true, sparse: true },
    status: { type: String, default: "preorder", index: true },
    roles: { type: [String], default: ["member"] }
  }, { collection:"users", timestamps:true });
  User = mongoose.model("User", userSchema);
}

function cleanupBOM(s){ return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

(async ()=>{
  await mongoose.connect(MONGODB_URI, { dbName:"onionunion" });

  const raw = cleanupBOM(fs.readFileSync(CSV_PATH, "utf8"));
  const rows = csvParse.parse(raw, { columns:true, skip_empty_lines:true, trim:true });

  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const handle = String(r.handle||r.帳號||r["OnionUnion帳號"]||"").trim();
    const wechat = String(r.wechat||r.微信||r["微信号"]||"").trim();
    if (!handle) { skipped++; continue; }

    const exists = await User.findOne({ handle: new RegExp(`^${handle}$`, "i") }).select({_id:1}).lean();
    if (exists) { skipped++; continue; }

    await User.insertMany([{ handle, wechat_id: wechat || null, status:"preorder", roles:["member"] }], { ordered:true });
    inserted++;
  }

  console.log({ ok:true, inserted, skipped, total: inserted+skipped, file: CSV_PATH });
  process.exit(0);
})().catch(e=>{
  console.error(e);
  process.exit(1);
});
