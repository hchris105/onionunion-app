// scripts/seed_admins.js
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const admins = [
  { handle: 'Egan', email: 'staystrong9@yeah.net',  password: 'xuxu1224' },
  { handle: 'Oscar', email: '520117162@qq.com',  password: 'MiskaMuska!' },
  { handle: 'Happypenguin',   email: 'hc850625@gmail.com',    password: 'Dpp19960105?' },
];

async function run(){
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'onionunion' });
  for (const a of admins) {
    const hash = await bcrypt.hash(a.password, 10);
    const r = await User.updateOne(
      { handle: new RegExp(`^${a.handle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'i') },
      { $set: { handle:a.handle, email:a.email, role:'admin', password_hash:hash }, $unset: { preorder:"" } },
      { upsert:true }
    );
    console.log('admin upsert', a.handle, r.upsertedCount ? 'created' : 'updated');
  }
  await mongoose.disconnect();
}
run().catch(e=>{ console.error(e); process.exit(1); });
