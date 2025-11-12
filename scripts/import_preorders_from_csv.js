// scripts/import_preorders_from_csv.js
// 用法：
//   DRY RUN（預設）：
//     node scripts/import_preorders_from_csv.js ./cyperhandle.csv \
//       --map handle=洋葱联盟账号,wechat_id=微信号,email=邮箱
//   正式套用：
//     node scripts/import_preorders_from_csv.js ./cyperhandle.csv \
//       --map handle=洋葱联盟账号,wechat_id=微信号,email=邮箱 --apply
//
// 規則：以 handle 為主鍵；email 僅在 (原本空) 或 (相同) 時寫入，否則跳過，避免唯一索引衝突。
// 新建用戶時，password=wechat_id 並 must_reset_password=true。

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import User from '../models/User.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/onionunion';

function parseArgs() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Error: need CSV path.');
    process.exit(1);
  }
  const csvPath = args[0];
  let mapStr = '';
  let apply = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--map') mapStr = args[++i] || '';
  }
  return { csvPath, mapStr, apply };
}

function buildHeaderMap(headerRow, mapStr) {
  const titles = headerRow.split(',').map(s => s.trim());
  // 如果沒傳 --map，試著自動匹配中英欄名
  const defaultMap = {
    handle: ['handle', '账号', '洋葱联盟账号', '洋蔥聯盟帳號'],
    wechat_id: ['wechat_id', '微信号', '微信號'],
    email: ['email', '邮箱', '郵箱', '官網帳號', '官網賬號']
  };

  // 使用者自訂映射（形如 "handle=洋葱联盟账号,wechat_id=微信号,email=邮箱"）
  const userMap = {};
  if (mapStr) {
    mapStr.split(',').forEach(pair => {
      const [k, v] = pair.split('=').map(s => (s || '').trim());
      if (k && v) userMap[k] = v;
    });
  }

  const locate = want => {
    // 先看自訂
    if (userMap[want]) {
      const idx = titles.findIndex(t => t === userMap[want]);
      if (idx >= 0) return idx;
    }
    // 再試預設候選
    for (const cand of defaultMap[want]) {
      const idx = titles.findIndex(t => t === cand);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const idx = {
    handle: locate('handle'),
    wechat_id: locate('wechat_id'),
    email: locate('email')
  };

  if (idx.handle < 0 || idx.wechat_id < 0) {
    throw new Error(
      `CSV must contain headers: handle(或 洋葱联盟账号), wechat_id(或 微信号)。email(官網帳號/郵箱) 可選。\n` +
      `實際標題：${titles.join(', ')}`
    );
  }
  return { titles, idx };
}

function readCSV(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8')
    // 翻掉 BOM
    .replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length <= 1) throw new Error('CSV 內容不足');
  return lines;
}

async function main() {
  const { csvPath, mapStr, apply } = parseArgs();
  await mongoose.connect(mongoUri, { dbName: 'onionunion' });
  console.log('[DB] connected');

  const lines = readCSV(csvPath);
  const { idx } = buildHeaderMap(lines[0], mapStr);

  let inserted = 0, updated = 0, kept = 0, failed = 0, skippedEmail = 0;

  // 從第 2 行開始處理
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    const handle = (cols[idx.handle] || '').trim();
    const wechat_id = (cols[idx.wechat_id] || '').trim();
    const email = idx.email >= 0 ? (cols[idx.email] || '').trim() : '';

    if (!handle) { kept++; continue; }

    try {
      const existing = await User.findOne({ handle }).lean();

      // 準備更新內容
      const set = {};
      const setOnInsert = {
        status: 'preorder',
        roles: ['member'],
        must_reset_password: true
      };

      // wechat_id 欄位本身可更新（空值就不寫）
      if (wechat_id) set.wechat_id = wechat_id;

      // email 寫入規則：只有 (原本空) 或 (相同) 時寫入；若不同且已被別人佔用 -> 跳過
      if (email) {
        let writeEmail = false;

        if (!existing) {
          // 新建時：只有「沒被別人占用」才寫入 email
          const emailHolder = await User.findOne({ email }).select('_id handle').lean();
          if (!emailHolder) writeEmail = true;
        } else {
          if (!existing.email || existing.email === email) {
            writeEmail = true;
          } else {
            // 檢查是否被他人佔用
            const someone = await User.findOne({ email, handle: { $ne: handle } })
              .select('_id handle').lean();
            if (someone) {
              writeEmail = false; // 跳過，避免唯一索引衝突
              skippedEmail++;
              console.log(`[skip_email_conflict] ${handle}: CSV(${email}) 已被 ${someone.handle} 使用，略過寫入 email`);
            } else {
              // 沒人佔用，但這位用戶原本有另一個 email -> 為保守，仍不覆蓋
              writeEmail = false;
              skippedEmail++;
              console.log(`[skip_email_keep_old] ${handle}: 原有 email(${existing.email}) != CSV(${email})，保持原值`);
            }
          }
        }

        if (writeEmail) set.email = email;
      }

      // 新建才做密碼初始
      if (!existing && wechat_id) setOnInsert.password = wechat_id;

      const update = {
        $set: set,
        $setOnInsert: setOnInsert
      };

      if (apply) {
        const res = await User.updateOne({ handle }, update, { upsert: true });
        if (res.upsertedCount > 0) {
          inserted++;
          console.log(`[preorder] ${handle}: inserted`);
        } else if (res.modifiedCount > 0) {
          updated++;
          console.log(`[preorder] ${handle}: updated`);
        } else {
          kept++;
          console.log(`[preorder] ${handle}: kept`);
        }
      } else {
        // DRY RUN
        const action = existing ? 'would_update' : 'would_insert';
        console.log(`[preorder] ${handle}: ${action}`);
        if (existing) updated++; else inserted++;
      }
    } catch (e) {
      failed++;
      console.log(`[error] ${handle}: ${e.message}`);
    }
  }

  console.log(`[result] inserted=${inserted} updated=${updated} kept=${kept} failed=${failed} skipped_email=${skippedEmail} total=${lines.length - 1}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
