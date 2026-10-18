#!/bin/bash
# 同步 core/ 业务层到 miniprogram/core/（小程序打包目录）
# core/ 是唯一真实来源；miniprogram/core/ 是构建产物，不要直接改。
# 每次修改 core/ 后运行本脚本。
set -e
cd "$(dirname "$0")/.."
# export-xlsx.js 是 Node 专用（依赖 exceljs，体积大），绝不进小程序包
cp core/*.js miniprogram/core/
rm -f miniprogram/core/export-xlsx.js
sed -i "s|require('../miniprogram/config/app-config')|require('../config/app-config')|g" miniprogram/core/*.js
echo "core/ -> miniprogram/core/ 同步完成"
