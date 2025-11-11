# OnionUnion App — 交接與待辦（2025-11-09, Asia/Taipei）

> 本文件給下一位 AI/工程師快速接手。包含現況、如何啟動、API 端點、管理後台、資料匯入與待辦清單。

---

## 0) 現況快照

- **語言 / 執行**：Node.js (ESM), Express, MongoDB (Mongoose)  
- **服務**：systemd 名稱 `onionunion`，API 監聽 `127.0.0.1:3000`（Nginx 反代）  
- **健康檢查**：`GET /healthz` → `{ ok, db: "up|down", ts }`  
- **主要路由**：
  - `/ask`：主功能（模型回覆；使用 `OPENAI_API_KEY/OPENAI_MODEL`）
  - `/auth`：登入/註冊/預約認領（包含 `preorder-lookup`、`claim`）
  - `/admin`：可視化後台（**已啟用**）
  - `/admin/api`：Admin API（**雙重保護：BasicAuth + X-Admin-Token**）
  - `/`：靜態首頁（`public/index.html`）
- **安全**：
  - 後台頁面 `/admin`：Basic Auth（`ADMIN_USER/ADMIN_PASS`）
  - 後台 API `/admin/api`：同時需要 `X-Admin-Token: <ADMIN_TOKEN>`
  - 建議完成作業後可設 `DISABLE_ADMIN=1` 關閉整個後台（保持伺服器「瘦」）

---

## 1) 如何啟動 / 重新啟動

```bash
# 改完 .env 後
sudo systemctl restart onionunion
journalctl -u onionunion -f   # 觀察啟動日誌
