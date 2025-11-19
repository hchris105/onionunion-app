#!/bin/bash

# 1. 建立前後端資料夾
echo "正在建立資料夾結構..."
mkdir -p backend
mkdir -p frontend

# 2. 移動後端檔案 (保護你的舊資產)
echo "正在移動現有檔案到 backend/..."

# 移動資料夾 (根據你的截圖)
mv routes models services data middleware lib tools scripts public node_modules backend/ 2>/dev/null

# 移動檔案
mv *.js *.json *.db *.csv *.lock backend/ 2>/dev/null

# 注意：.git 資料夾不會被移動，這很重要

# 3. 建立前端基本結構
echo "正在初始化 frontend/..."
# 如果 frontend 裡面是空的，或是剛剛才建立的
mkdir -p frontend/public
mkdir -p frontend/src
mkdir -p frontend/src/components
mkdir -p frontend/src/pages
mkdir -p frontend/src/services

echo "========================================"
echo "整理完成！"
echo "現在你的根目錄應該只有：backend/, frontend/ 和 .git/"
echo "========================================"
