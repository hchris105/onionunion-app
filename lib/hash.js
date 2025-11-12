// lib/hash.js
import bcrypt from 'bcrypt';

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

export async function hashPassword(plain) {
  if (!plain) return '';
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(stored, input) {
  if (!stored) return false;
  // 兼容舊資料：若 stored 不是 bcrypt 格式，改用明文比對（僅用於舊帳號過渡）
  const isBcrypt = typeof stored === 'string' && stored.startsWith('$2');
  if (!isBcrypt) return stored === input;
  try {
    return await bcrypt.compare(input, stored);
  } catch {
    return false;
  }
}
