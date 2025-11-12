// services/db.js
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/onionunion';
const opts = {
  // 避免重複建立索引的競態
  autoIndex: true,
  serverSelectionTimeoutMS: 8000,
  maxPoolSize: 10,
};

let connected = false;

export async function connectDB() {
  if (connected) return mongoose.connection;
  try {
    await mongoose.connect(uri, opts);
    connected = true;
    console.log('[DB] connected');
    return mongoose.connection;
  } catch (err) {
    console.error('[DB] connect error:', err?.message || err);
    throw err;
  }
}

// 立即嘗試連線（server 啟動時載入本檔即可）
// 若你想延遲載入，可移除下一行，改由 server.js 主動呼叫 connectDB()
connectDB().catch(() => {});
