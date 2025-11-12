// scripts/seed_admins.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
dotenv.config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/onionunion';

// 用法：
//   ADMIN_ACCOUNTS="shen:123456,root:123456" node scripts/seed_admins.js
// 或：
//   node scripts/seed_admins.js shen:123456 root:123456
function parseAccounts() {
  const env = process.env.ADMIN_ACCOUNTS || '';
  const args = process.argv.slice(2);
  const list = (env ? env.split(',') : []).concat(args);

  return list
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const [handle, pwd] = pair.split(':');
      return { handle, pwd: pwd || '123456' };
    });
}

async function main() {
  const accounts = parseAccounts();
  if (!accounts.length) {
    console.log('Usage: ADMIN_ACCOUNTS="shen:123456,root:123456" node scripts/seed_admins.js');
    console.log('   or: node scripts/seed_admins.js shen:123456 root:123456');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URL);
  console.log('[DB] connected');

  let inserted = 0, updated = 0;
  for (const acc of accounts) {
    try {
      const u = await User.findOne({ handle: acc.handle });
      if (!u) {
        await User.create({
          handle: acc.handle,
          email: '',
          wechat_id: '',
          roles: ['admin'],
          status: 'active',
          password: acc.pwd,
          must_reset_password: true,
        });
        console.log('[admin] inserted:', acc.handle);
        inserted++;
      } else {
        await User.updateOne(
          { _id: u._id },
          {
            $set: {
              roles: Array.from(new Set([...(u.roles || []), 'admin'])),
              status: 'active',
              // 不強制改密碼，除非 u 還沒有密碼
              ...(u.password ? {} : { password: acc.pwd, must_reset_password: true }),
            },
          }
        );
        console.log('[admin] updated:', acc.handle);
        updated++;
      }
    } catch (e) {
      console.log('[admin] ERROR', acc.handle, e.message);
    }
  }

  console.log(`[admin] inserted=${inserted} updated=${updated} kept=0`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
