#!/bin/bash

# 1. 安全備份 (Backup)
# 會在當前目錄產生一個帶時間戳記的壓縮檔，例如 backup_20231119_1200.tar.gz
TIMESTAMP=$(date +%Y%m%d_%H%M)
BACKUP_FILE="backup_${TIMESTAMP}.tar.gz"

echo "📦 正在建立全站備份: $BACKUP_FILE ..."
# 排除 node_modules 以免備份檔過大
tar --exclude='node_modules' --exclude='backend/node_modules' --exclude='frontend/node_modules' -czf "$BACKUP_FILE" .

echo "✅ 備份完成！如果還原出錯，可以用這個檔案恢復。"
echo "-------------------------------------------"

# 2. 還原結構 (Restore Structure)
echo "🔄 正在還原檔案結構..."

# 把 backend 裡面的所有東西搬回根目錄
# cp -r 比 mv 更安全，因為如果出錯還有原本的
cp -r backend/* .
cp backend/.env . 2>/dev/null
cp backend/package.json . 2>/dev/null
cp backend/.gitignore . 2>/dev/null

# 3. 清理 (Cleanup)
echo "🧹 正在清理生成的資料夾..."
# 刪除我建立的前端
rm -rf frontend
# 刪除空的 backend 資料夾 (如果搬移成功)
rm -rf backend

# 刪除我給你的腳本
rm -f setup_structure.sh install_frontend.sh update_frontend.sh apply_theme.sh deploy.sh full_reset.sh emergency_fix.sh

echo "-------------------------------------------"
echo "✅ 結構已還原。"
echo "現在檔案應該都在根目錄了 (routes, models, services...)"
echo "請檢查 server.js 是否為你原本的內容，如果被我覆蓋了，請從 git 歷史紀錄還原。"
