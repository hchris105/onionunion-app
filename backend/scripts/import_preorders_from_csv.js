// scripts/import_preorders_from_csv.js
// Usage:
//   node scripts/import_preorders_from_csv.js ./cyperhandle.csv \
//     --map='handle=洋葱联盟账号,wechat_id=微信号,email=官网账号' [--apply] [--batch=100]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { parse as csvParse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- CLI ----
const [, , csvFile, ...rest] = process.argv;
if (!csvFile) {
  console.error('Usage: node scripts/import_preorders_from_csv.js <csvFile> --map="handle=...,wechat_id=...,email=..." [--apply] [--batch=100]');
  process.exit(1);
}

let APPLY = false;
let BATCH = 100;
let MAP = null;

for (const arg of rest) {
  if (arg === '--apply') APPLY = true;
  else if (arg.startsWith('--batch=')) BATCH = Math.max(1, parseInt(arg.slice(8), 10) || 100);
  else if (arg.startsWith('--map=')) {
    const mapStr = arg.slice(6);
    MAP = {};
    for (const pair of mapStr.split(',')) {
      const [k, v] = pair.split('=');
      if (!k || !v) {
        console.error('✗ 無效的 --map 配對：', pair);
        process.exit(1);
      }
      MAP[k.trim()] = v.trim();
    }
  }
}
if (!MAP) {
  console.error('✗ 缺少 --map 參數，例如 --map=\'handle=洋葱联盟账号,wechat_id=微信号,email=官网账号\'');
  process.exit(1);
}

// ---- ENV / DB ----
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/onionunion';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// ---- helpers ----
const norm = (s) => (s ?? '').replace(/^\uFEFF/, '').trim(); // 去 BOM + trim
function ensureField(headers, want) {
  const t = norm(want);
  return headers.find((h) => norm(h) === t) || null;
}

async function main() {
  console.log('[import] csv =', csvFile);
  const raw = fs.readFileSync(csvFile, 'utf8');

  const rows = csvParse(raw, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  });
  if (!rows.length) {
    console.log('✗ 檔案為空');
    return;
  }

  const headers = Object.keys(rows[0] || {});
  console.log('[import] 解析到欄位 headers =', headers);

  const srcHandle = ensureField(headers, MAP.handle);
  const srcWechat = ensureField(headers, MAP.wechat_id);
  const srcEmail  = ensureField(headers, MAP.email);

  const missing = [];
  if (!srcHandle) missing.push(`handle→${MAP.handle}`);
  if (!srcWechat) missing.push(`wechat_id→${MAP.wechat_id}`);
  if (!srcEmail)  missing.push(`email→${MAP.email}`);
  if (missing.length) {
    console.error('✗ 對應不到欄位：', missing.join(', '));
    return;
  }

  const docs = [];
  for (const r of rows) {
    const handle = norm(r[srcHandle]);
    if (!handle) continue;
    const wechat = norm(r[srcWechat]) || null;
    const email  = norm(r[srcEmail])  || null;
    docs.push({ handle, wechat_id: wechat, email });
  }
  console.log(`[import] 解析有效筆數：${docs.length}`);

  console.log('[DB] 連線中 …', MONGODB_URI);
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000, directConnection: true });
  console.log('[DB] connected');

  // 明確載入你的 model
  const { default: User } = await import(path.resolve(__dirname, '../models/User.js'));

  // 索引（存在就忽略）
  console.log('[index] ensure …');
  await Promise.allSettled([
    User.collection.createIndex({ handle: 1 }, { unique: true, background: true, name: 'handle_1' }),
    User.collection.createIndex({ email: 1 }, {
      unique: true, background: true, name: 'email_1',
      partialFilterExpression: { email: { $gt: '' } },
    }),
    User.collection.createIndex({ wechat_id: 1 }, { background: true, name: 'wechat_id_1' }),
    User.collection.createIndex({ status: 1 }, { background: true, name: 'status_1' }),
    User.collection.createIndex({ roles: 1 }, { background: true, name: 'roles_1' }),
  ]);
  console.log('[index] done');

  if (!APPLY) {
    console.log('[dry-run] 範例前 3 筆：');
    console.log(docs.slice(0, 3));
    await mongoose.disconnect();
    console.log('[dry-run] 未寫入（未加 --apply）');
    return;
  }

  console.log(`[apply] 開始分批寫入，batch=${BATCH} …`);

  let upserted = 0, matched = 0, modified = 0, failed = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    // 預算密碼
    const ops = [];
    for (const d of chunk) {
      const set = { handle: d.handle, email: d.email, wechat_id: d.wechat_id };
      if (d.wechat_id) {
        set.passwordHash = await bcrypt.hash(d.wechat_id, BCRYPT_ROUNDS);
      }
      ops.push({
        updateOne: {
          filter: { handle: d.handle },
          update: {
            $setOnInsert: { createdAt: new Date(), status: 'preorder', roles: ['member'] },
            $set: set,
          },
          upsert: true,
        }
      });
    }

    try {
      const res = await User.bulkWrite(ops, { ordered: false });
      upserted += res.upsertedCount || 0;
      matched  += res.matchedCount  || 0;
      modified += res.modifiedCount || 0;
      console.log(`[apply] 第 ${Math.floor(i/BATCH)+1} 批 ok  upserted=${res.upsertedCount||0} matched=${res.matchedCount||0} modified=${res.modifiedCount||0}`);
    } catch (e) {
      failed += chunk.length;
      console.error(`[apply] 第 ${Math.floor(i/BATCH)+1} 批失敗：`, e?.writeErrors?.[0]?.errmsg || e?.message || e);
    }
  }

  const total = await User.countDocuments();
  console.log('[apply] done. summary:', { upserted, matched, modified, failed, total });

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('✗ FATAL:', e?.message || e);
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  process.exit(1);
});
