#!/bin/bash
# 部署文档到 GitHub Pages

set -e

# 进入 docs 目录
cd "$(dirname "$0")/docs"

echo "📦 安装依赖..."
npm install

echo "🔨 构建文档..."
npm run docs:build

echo "🚀 部署到 gh-pages..."

# 进入构建输出目录
cd .vitepress/dist

# 初始化 git 并提交
git init
git config user.name "GitHub Actions"
git config user.email "actions@github.com"
git add -A
git commit -m "deploy: 更新文档"

# 推送到 gh-pages 分支
git push -f https://github.com/zijinmengli-svg/pdf-compress-web.git main:gh-pages

cd -

echo "✅ 文档部署完成！"
echo "📖 访问地址：https://zijinmengli-svg.github.io/pdf-compress-web/"
