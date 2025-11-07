require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

app.use(express.json({ limit: '2mb' }));

// 允許 prompt 或 question 兩種參數
app.use((req, res, next) => {
  if (req.body && typeof req.body.prompt === 'string' && !req.body.question) {
    req.body.question = req.body.prompt;
  }
  next();
});

// 靜態前端（/public）
app.use(express.static(path.join(__dirname, 'public')));

// ────────────────────────────────────────────────────────────
// DB：站點設定 / Prompt 套件 / Ingest 設定
// ────────────────────────────────────────────────────────────
const dbPath = path.join(__dirname, 'data', 'app.db');
const db = new Database(dbPath);
function getSiteConfig() {
  return db.prepare('SELECT * FROM site_config WHERE id=1').get();
}
function getIngest() {
  return db.prepare('SELECT * FROM ingest_settings WHERE id=1').get();
}
function getPromptByName(name) {
  return db.prepare('SELECT * FROM prompts WHERE name=?').get(name);
}
function listPrompts() {
  return db.prepare('SELECT * FROM prompts ORDER BY id').all();
}
function upsertSiteConfig(p) {
  db.prepare(`
  UPDATE site_config SET
    site_name=@site_name, site_key=@site_key, default_model=@default_model,
    max_tokens=@max_tokens, temperature=@temperature, rate_limit_per_min=@rate_limit_per_min,
    allowed_origins=@allowed_origins, answer_max_chars=@answer_max_chars
  WHERE id=1
  `).run(p);
}

// 字串模板 {{var}}
function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

// ────────────────────────────────────────────────────────────
// RAG：載入 chunks.json + 穩定的中文比對 & fallback
// ────────────────────────────────────────────────────────────
const chunksFile = path.join(__dirname, 'data', 'chunks.json');
let CHUNKS = [];
function loadChunks() {
  try {
    CHUNKS = JSON.parse(fs.readFileSync(chunksFile, 'utf8'));
    console.log(`Loaded ${CHUNKS.length} chunks from ${chunksFile}`);
  } catch (e) {
    CHUNKS = [];
    console.log('No chunks.json yet. Please run ingest script.');
  }
}
loadChunks();

// 正規化中文字詞（僅保留中字/英字/數字，其他變空白）
function normCN(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
    .trim();
}

// 簡單關鍵字得分
function scoreChunk(text, keys) {
  const t = normCN(text);
  let score = 0;
  for (const k of keys) {
    if (!k) continue;
    if (t.includes(k)) score++;
  }
  return score;
}

/**
 * 產生 context：
 * - 先依關鍵字排序
 * - 就算全部 0 分，也會以前 topK 當 fallback，避免回空
 * - 合併時控制總字數上限
 */
function buildContext(question, extras = '', topK = 8, maxChars = 1800) {
  if (!Array.isArray(CHUNKS) || CHUNKS.length === 0) return '';

  const keys = normCN(`${question} ${extras}`)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20);

  const scored = CHUNKS.map(c => ({
    score: scoreChunk(c.text || '', keys),
    text: c.text,
    source: c.source
  })).sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, Math.max(1, topK)); // fallback：即使全 0 分也拿前 topK

  let buf = '';
  for (const p of picked) {
    if (!p || !p.text) continue;
    if ((buf + p.text).length > maxChars) break;
    buf += `【來源:${p.source || '合成器'}】\n${p.text}\n\n`;
  }
  return buf.trim();
}

// ────────────────────────────────────────────────────────────
// 健康檢查 + 偵錯端點
// ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('OnionUnion API OK ✅ (Claude)');
});

// 目前載入狀態
app.get('/debug/status', (req, res) => {
  res.json({
    chunks_loaded: Array.isArray(CHUNKS) ? CHUNKS.length : 0,
    chunks_path: chunksFile
  });
});

// 檢查取到的 context
app.get('/debug/context', (req, res) => {
  const q = req.query.q || '';
  const ctx = buildContext(q, '', 8, 1500);
  res.type('text/plain').send(ctx || '(empty)');
});

// ────────────────────────────────────────────────────────────
// 問答端點
// ────────────────────────────────────────────────────────────
app.post('/ask', async (req, res) => {
  try {
    if (!CLAUDE_API_KEY) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY not set' });
    }

    const {
      myName, myBirth, myMother,
      otherName, otherBirth, otherMother,
      question, mode = 'general'
    } = req.body || {};

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    const site = getSiteConfig();
    const ingest = getIngest();
    const promptPack = getPromptByName(mode) || getPromptByName('general');

    // 使用者資料（會放進 prompt）
    const profile = `
我的姓名：${myName || '（未填）'}
我的生日：${myBirth || '（未填）'}
我的母親姓名：${myMother || '（未填）'}
${(otherName || otherBirth || otherMother) ? `
對方姓名：${otherName || '（未填）'}
對方生日：${otherBirth || '（未填）'}
對方母親姓名：${otherMother || '（未填）'}` : ''}`.trim();

    // RAG context
    const context = buildContext(
      question,
      [myName, myBirth, myMother, otherName, otherBirth, otherMother].filter(Boolean).join(' '),
      ingest?.top_k || 8,
      1800
    );

    // 若 context 太少，直接拒答，避免模型亂講
    if (!context || context.trim().length < 80) {
      return res.json({
        error: 'need_more_source',
        message: '需要更多合成器內容：請上傳/補充相關章節並重建知識庫。'
      });
    }

    // System + User Prompt（可在後台覆蓋；這裡是強制安全的預設）
    const system = (promptPack?.system_prompt || `
你是「OnionUnion」神祕學顧問，只能根據《合成器》的節錄內容回答。
規則：
1) 嚴禁使用外部知識或網路資料；只能引用「知識庫節錄」。
2) 必須逐點引用節錄中的內容（標註：來源：合成器.pdf-某節），不可憑空推論。
3) 禁止洩露任何公式或完整計算步驟；請以女性易懂的語言輸出「結論 / 理由摘要 / 建議 / 引用」。
4) 若節錄不足以回答，請回 need_more_source 並列出需要補充的關鍵章節或關鍵字。
（內部先完成嚴謹推理，但不要輸出你的思考過程）
`).trim();

    const userTpl = promptPack?.user_template
      || '【使用者】\n{{user_profile}}\n\n【問題】\n{{question}}\n\n【模式】{{mode}}\n\n【知識庫節錄】\n{{context}}';

    const userPrompt = renderTemplate(userTpl, {
      user_profile: profile,
      question,
      mode,
      context
    });

    // 呼叫 Claude
    const r = await axios.post(CLAUDE_URL, {
      model: (site?.default_model || 'claude-3-5-sonnet-20240620'),
      max_tokens: Number(site?.max_tokens || 700),
      system,
      messages: [{ role: 'user', content: userPrompt }]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 60000,
    });

    const answer = r.data?.content?.[0]?.text || '(沒有生成內容)';
    const trimmed = (site?.answer_max_chars)
      ? answer.slice(0, Number(site.answer_max_chars))
      : answer;

    res.json({
      answer: trimmed,
      mode,
      used_model: r.data?.model,
      tokens: r.data?.usage
    });

  } catch (err) {
    console.error(err?.response?.data || err);
    res.status(500).json({ error: 'server_error', detail: err?.message || String(err) });
  }
});

// ────────────────────────────────────────────────────────────
// 後台（Basic-Auth）
// ────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    return res.status(401).send('Auth required');
  }
  const [u, p] = Buffer.from(hdr.split(' ')[1], 'base64').toString().split(':');
  if (u === process.env.ADMIN_USER && p === process.env.ADMIN_PASS) return next();
  return res.status(401).send('Bad credentials');
}

const upload = multer({
  dest: path.join(__dirname, 'data', 'uploads'),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

// Admin 主頁
app.get('/admin', adminAuth, (req, res) => {
  const site = getSiteConfig();
  const pms  = listPrompts();
  const ing  = getIngest();
  res.type('html').send(`
<!doctype html><meta charset="utf-8"><title>Admin</title>
<style>body{font:14px system-ui;padding:20px;max-width:900px;margin:auto;}input,textarea{width:100%;}details{margin:8px 0}</style>
<h1>OnionUnion 後台</h1>

<h2>站點設定</h2>
<form method="post" action="/admin/site">
  站名 <input name="site_name" value="${site.site_name||''}">
  Site Key <input name="site_key" value="${site.site_key||''}">
  模型 <input name="default_model" value="${site.default_model||''}">
  Max Tokens <input name="max_tokens" value="${site.max_tokens||700}">
  Temperature <input name="temperature" value="${site.temperature||0.7}">
  每分鐘限流 <input name="rate_limit_per_min" value="${site.rate_limit_per_min||30}">
  允許來源 <input name="allowed_origins" value="${site.allowed_origins||'*'}">
  答案字數上限 <input name="answer_max_chars" value="${site.answer_max_chars||1800}">
  <button>儲存</button>
</form>

<h2>Prompt 套件</h2>
${pms.map(p=>`
  <details><summary>${p.name} ${p.enabled?'(啟用)':'(關閉)'}</summary>
    <form method="post" action="/admin/prompt/${p.id}">
      名稱 <input name="name" value="${p.name}">
      啟用(0/1) <input name="enabled" value="${p.enabled}">
      <div>System Prompt<br><textarea name="system_prompt" rows="6">${p.system_prompt||''}</textarea></div>
      <div>User Template<br><textarea name="user_template" rows="6">${p.user_template||''}</textarea></div>
      備註 <input name="notes" value="${p.notes||''}">
      <button>儲存</button>
    </form>
  </details>
`).join('')}

<h2>知識庫</h2>
<form method="post" action="/admin/ingest-settings">
  chunk_size <input name="chunk_size" value="${ing.chunk_size}">
  chunk_overlap <input name="chunk_overlap" value="${ing.chunk_overlap}">
  min_chunk_len <input name="min_chunk_len" value="${ing.min_chunk_len}">
  top_k <input name="top_k" value="${ing.top_k}">
  search_fuzzy <input name="search_fuzzy" value="${ing.search_fuzzy}">
  PDF 目錄 <input name="pdf_storage_path" value="${ing.pdf_storage_path}">
  <button>儲存設定</button>
</form>

<h3>上傳 PDF</h3>
<form method="post" enctype="multipart/form-data" action="/admin/upload">
  <input type="file" name="pdf" accept="application/pdf">
  <button>上傳</button>
</form>

<form method="post" action="/admin/rebuild">
  <button>重建知識庫</button>
</form>
`);
});

app.post('/admin/site', adminAuth, express.urlencoded({extended:true}), (req,res)=>{
  upsertSiteConfig({
    site_name: req.body.site_name,
    site_key: req.body.site_key,
    default_model: req.body.default_model,
    max_tokens: +req.body.max_tokens,
    temperature: +req.body.temperature,
    rate_limit_per_min: +req.body.rate_limit_per_min,
    allowed_origins: req.body.allowed_origins,
    answer_max_chars: +req.body.answer_max_chars
  });
  res.redirect('/admin');
});

app.post('/admin/prompt/:id', adminAuth, express.urlencoded({extended:true}), (req,res)=>{
  db.prepare(`UPDATE prompts SET
    name=@name, system_prompt=@system_prompt, user_template=@user_template,
    enabled=@enabled, notes=@notes
    WHERE id=@id`).run({
      id: +req.params.id,
      name: req.body.name,
      system_prompt: req.body.system_prompt,
      user_template: req.body.user_template,
      enabled: +req.body.enabled || 0,
      notes: req.body.notes
    });
  res.redirect('/admin');
});

app.post('/admin/ingest-settings', adminAuth, express.urlencoded({extended:true}), (req,res)=>{
  db.prepare(`UPDATE ingest_settings SET
    chunk_size=@chunk_size, chunk_overlap=@chunk_overlap,
    min_chunk_len=@min_chunk_len, top_k=@top_k, search_fuzzy=@search_fuzzy,
    pdf_storage_path=@pdf_storage_path
    WHERE id=1`).run({
      chunk_size:+req.body.chunk_size,
      chunk_overlap:+req.body.chunk_overlap,
      min_chunk_len:+req.body.min_chunk_len,
      top_k:+req.body.top_k,
      search_fuzzy:+req.body.search_fuzzy,
      pdf_storage_path:req.body.pdf_storage_path
    });
  res.redirect('/admin');
});

app.post('/admin/upload', adminAuth, upload.single('pdf'), (req,res)=>{
  const ing = getIngest();
  const dest = path.join(__dirname, ing.pdf_storage_path);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, {recursive:true});
  const final = path.join(dest, req.file.originalname.replace(/[^\w\.\-\u4e00-\u9fa5]/g,'_'));
  fs.renameSync(req.file.path, final);
  res.redirect('/admin');
});

app.post('/admin/rebuild', adminAuth, async (req,res)=>{
  const { spawn } = require('child_process');
  const p = spawn('node', ['tools/ingest.js'], { cwd: __dirname });
  p.stdout.on('data', d => process.stdout.write(d));
  p.stderr.on('data', d => process.stderr.write(d));
  p.on('close', code => { console.log('ingest exit', code); loadChunks(); });
  res.send('已觸發重建，請稍後重整 /admin 查看結果');
});

// ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
