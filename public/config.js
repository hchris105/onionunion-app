/* public/config.js — 前端可調參數（供 ui.js 使用） */
window.API_BASE = "";              // 同源部署：留空即可；若走子域/反代，填 e.g. "https://api.onionunion.app"
window.API_TIMEOUT_MS = 300000;    // 非流式 fallback 時間（ui.js 會用到）
