# OnionUnion AI 占卜系統

## 📌 專案架構

本專案提供占卜/測算 AI 服務，基於 Claude API 與本地 PDF
知識庫（合成器）實現。 支援後台管理參數（模型選擇、Prompt 模板、最大
Token 等）。

### 主要檔案

-   `server.js`：主後端入口（原本的 index.js 已移除）
-   `routes/ask.js`：占卜請求處理
-   `routes/admin.js`：管理者後台
-   `tools/ingest.js`：PDF 知識庫解析器
-   `data/chunks.json`：PDF 知識分塊結果
-   `config.js`：集中管理環境變數與預設值
-   `.env`：環境變數（API Key、模型、Token 等）

---

## ⚙️ 環境變數 `.env`

```ini
# Claude API Key
CLAUDE_API_KEY=你的API金鑰

# 使用的模型（建議 Claude Opus）
CLAUDE_MODEL=claude-3-opus-20240229

# 最大輸出 Token （Opus 支援最多 30,000，可視需求調整）
MAX_TOKENS=8000

# 溫度（建議 0.25 ~ 0.4，較穩定）
TEMPERATURE=0.3

# 管理者帳密（登入後台用）
ADMIN_USER=admin
ADMIN_PASS=changeme
🚀 啟動方式
bash
複製程式碼
# 安裝依賴
npm install

# 啟動服務
node server.js
或使用 systemd：

bash
複製程式碼
sudo systemctl restart onionunion
啟動後，Log 會顯示：

pgsql
複製程式碼
Server listening on 3000
🚀 Model: claude-3-opus-20240229 max_tokens: 8000 temp: 0.3
🛠️ 功能
一般占卜：輸入問題，系統依據 PDF 知識庫與 Prompt 回答。

模式選擇：支援「一般占卜」「塔羅」「占星」。

知識庫：支援自行上傳 PDF（合成器），自動切分成 chunks.json。

後台：允許管理者調整 Prompt、模型、Token 上限等。

新增 /admin/config：可快速查看目前系統生效的模型與參數。

📖 Prompt 設計
系統會合併以下三部分：

System Prompt：限制 AI 語氣、禁止暴露公式、保持女性友好解釋。

User Profile：使用者輸入的姓名、生日、母親姓名、對方資料。

Knowledge Context：來自 chunks.json 的相關段落。

範例：

複製程式碼
你是【OnionUnion】神秘學顧問，熟讀《合成器》。請用女性容易理解的方式回答。
不得暴露任何公式或運算細節，語氣溫柔，具啟發性。