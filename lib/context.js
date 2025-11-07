const fs = require('fs');
const path = require('path');

const chunksFile = path.join(__dirname, '..', 'data', 'chunks.json');
let CHUNKS = [];

function loadChunks() {
  try {
    CHUNKS = JSON.parse(fs.readFileSync(chunksFile, 'utf8'));
    console.log(`Loaded ${CHUNKS.length} chunks from ${chunksFile}`);
  } catch {
    CHUNKS = [];
    console.log('No chunks.json yet. Please run ingest script.');
  }
}
loadChunks();

function normCN(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
    .trim();
}
function scoreChunk(text, keys) {
  const t = normCN(text);
  let score = 0;
  for (const k of keys) {
    if (!k) continue;
    if (t.includes(k)) score++;
  }
  return score;
}

/** 建 context：關鍵字排序；即使全 0 分也回前 topK（避免空） */
function buildContext(question, extras = '', topK = 8, maxChars = 1800) {
  if (!Array.isArray(CHUNKS) || CHUNKS.length === 0) return '';
  const keys = normCN(`${question} ${extras}`).split(/\s+/).filter(Boolean).slice(0, 20);
  const scored = CHUNKS.map(c => ({
    score: scoreChunk(c.text || '', keys),
    text: c.text,
    source: c.source
  })).sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, Math.max(1, topK));
  let buf = '';
  for (const p of picked) {
    if (!p?.text) continue;
    if ((buf + p.text).length > maxChars) break;
    buf += `【來源:${p.source || '合成器'}】\n${p.text}\n\n`;
  }
  return buf.trim();
}

function chunksCount() {
  return Array.isArray(CHUNKS) ? CHUNKS.length : 0;
}

module.exports = { buildContext, loadChunks, chunksCount, chunksFile };
