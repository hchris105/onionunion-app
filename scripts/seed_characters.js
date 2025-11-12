// scripts/seed_characters.js  (FIXED)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../services/db.js';
import { Character } from '../models/Character.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJSON(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const root = path.join(__dirname, '..');
  const jsonPath = path.join(root, 'characters', 'characters.json');

  if (!fs.existsSync(jsonPath)) {
    console.error('[seed_characters] not found:', jsonPath);
    process.exit(1);
  }

  if (args.has('--wipe')) {
    const n = await Character.deleteMany({});
    console.log(`[seed_characters] wiped characters: ${n.deletedCount}`);
  }

  if (args.has('--reset-used')) {
    const n = await Character.updateMany({}, { $set: { used: false, assigned_to: null } });
    console.log(`[seed_characters] reset used flags: ${n.modifiedCount}`);
  }

  const list = readJSON(jsonPath);
  let inserted = 0, updated = 0, skipped = 0;

  for (const item of list) {
    if (!item.code || !item.name) { skipped++; continue; }

    // 僅設定角色基本屬性；不動 used/assigned_to
    const payload = {
      code: String(item.code).trim(),
      name: String(item.name).trim(),
      tier: item.tier || '',
      series: item.series || '',
      archetype: item.archetype || '',
      r: Number(item.r || 0),
      available: item.available !== false
    };

    const res = await Character.updateOne(
      { code: payload.code },
      { $set: payload },
      { upsert: true }
    );

    if (res.upsertedCount) inserted++;
    else if (res.matchedCount && res.modifiedCount) updated++;
    else skipped++;
  }

  console.log(`[seed_characters] inserted=${inserted} updated=${updated} skipped=${skipped} total=${list.length}`);
  process.exit(0);
}

main().catch(err => { console.error('[seed_characters] error:', err); process.exit(1); });
