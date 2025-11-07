const Database = require('better-sqlite3');
const db = new Database('./data/app.db');

db.exec(`
CREATE TABLE IF NOT EXISTS site_config (
  id INTEGER PRIMARY KEY CHECK (id=1),
  site_name TEXT DEFAULT 'OnionUnion',
  site_key TEXT,
  default_model TEXT DEFAULT 'claude-3-5-sonnet-20240620',
  max_tokens INTEGER DEFAULT 700,
  temperature REAL DEFAULT 0.7,
  rate_limit_per_min INTEGER DEFAULT 30,
  allowed_origins TEXT DEFAULT '*',
  answer_max_chars INTEGER DEFAULT 1800
);

INSERT OR IGNORE INTO site_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  system_prompt TEXT,
  user_template TEXT,
  enabled INTEGER DEFAULT 1,
  notes TEXT
);

INSERT OR IGNORE INTO prompts(name, system_prompt, user_template, notes) VALUES(
  'general',
  '你是「OnionUnion」神秘學顧問，熟讀《合成器》。請用女性容易理解的方式回答；不得洩露任何公式或運算細節；語氣溫柔、具啟發；必要時引用知識庫重點。',
  '【使用者】\n{{user_profile}}\n\n【問題】\n{{question}}\n\n【模式】{{mode}}\n\n【知識庫節錄】\n{{context}}',
  '預設一般占卜'
);

CREATE TABLE IF NOT EXISTS ingest_settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  chunk_size INTEGER DEFAULT 700,
  chunk_overlap INTEGER DEFAULT 80,
  min_chunk_len INTEGER DEFAULT 120,
  top_k INTEGER DEFAULT 5,
  search_fuzzy REAL DEFAULT 0.1,
  pdf_storage_path TEXT DEFAULT 'data/pdfs',
  last_ingest_at TEXT,
  ingest_log TEXT
);

INSERT OR IGNORE INTO ingest_settings (id) VALUES (1);
`);

console.log('DB initialized ✅');
