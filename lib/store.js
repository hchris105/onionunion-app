const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);

function getSiteConfig() {
  return db.prepare('SELECT * FROM site_config WHERE id=1').get();
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

function getIngest() {
  return db.prepare('SELECT * FROM ingest_settings WHERE id=1').get();
}

function getPromptByName(name) {
  return db.prepare('SELECT * FROM prompts WHERE name=?').get(name);
}
function listPrompts() {
  return db.prepare('SELECT * FROM prompts ORDER BY id').all();
}
function updatePromptById(payload) {
  db.prepare(`UPDATE prompts SET
    name=@name, system_prompt=@system_prompt, user_template=@user_template,
    enabled=@enabled, notes=@notes
    WHERE id=@id`).run(payload);
}

function updateIngestSettings(p) {
  db.prepare(`UPDATE ingest_settings SET
    chunk_size=@chunk_size, chunk_overlap=@chunk_overlap,
    min_chunk_len=@min_chunk_len, top_k=@top_k, search_fuzzy=@search_fuzzy,
    pdf_storage_path=@pdf_storage_path
    WHERE id=1`).run(p);
}

module.exports = {
  db,
  getSiteConfig,
  upsertSiteConfig,
  getIngest,
  getPromptByName,
  listPrompts,
  updatePromptById,
  updateIngestSettings,
};
