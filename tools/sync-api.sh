#!/bin/bash
# 同步 core/ 业务层到 cloudfunctions/api/（云函数部署目录）
# core/ 是唯一真实来源；cloudfunctions/api/core/ 是构建产物，不要直接改。
# 布局与仓库根保持一致（api/core + api/miniprogram/config），
# 这样 core 里的 require('../miniprogram/config/app-config') 在云函数内原样可解析。
# 每次修改 core/ 后运行本脚本（与 sync-core.sh 配套）。
set -e
cd "$(dirname "$0")/.."
rm -rf cloudfunctions/api/core cloudfunctions/api/miniprogram
mkdir -p cloudfunctions/api/core cloudfunctions/api/miniprogram/config
cp core/*.js cloudfunctions/api/core/
cp miniprogram/config/app-config.js cloudfunctions/api/miniprogram/config/app-config.js
echo "core/ -> cloudfunctions/api/core/ 同步完成"
