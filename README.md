# PDF 压缩神器 v1.0.0

一个功能完整的PDF在线压缩工具网站，支持按目标大小压缩PDF文件。

## ✨ 功能特性

- 📄 **PDF上传**：支持拖拽和点击上传PDF文件
- 🎯 **目标大小压缩**：输入期望的文件大小，自动压缩到目标大小
- 📊 **实时进度**：显示压缩进度和压缩结果
- 💾 **一键下载**：压缩完成后直接下载文件
- 🆓 **完全免费**：无次数限制，无付费功能

## 🛠️ 技术栈

- **后端**：Node.js + 原生HTTP服务器
- **前端**：原生HTML/CSS/JavaScript
- **PDF压缩**：Swift + PDFKit + QuartzFilter (macOS专用)

## 💻 系统要求

- **操作系统**：macOS 10.15或更高版本
- **Node.js**：v14或更高版本
- **Swift**：Xcode Command Line Tools

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装Xcode Command Line Tools (如果未安装)
xcode-select --install

# 确认Node.js已安装
node --version
```

### 2. 启动应用

```bash
# 进入项目目录
cd /path/to/pdf-compress-web

# 启动服务器（使用v1.0.0简化版）
node server-simple.js
```

### 3. 访问网站

打开浏览器访问：http://127.0.0.1:3487

## 📖 文档

详细文档请访问：https://zijinmengli-svg.github.io/pdf-compress-web/

或查看本地文档目录：`docs/`

## 📁 项目结构

```
pdf-compress-web/
├── server-simple.js       # v1.0.0 简化版服务器（推荐）
├── server.js              # 完整版服务器（含付费功能）
├── package.json           # 项目配置
├── README.md              # 本文件
├── public/                # 前端静态文件
│   ├── index-simple.html # v1.0.0 简化版首页
│   ├── app-simple.js     # v1.0.0 简化版脚本
│   └── styles.css        # 样式文件
├── scripts/               # Swift压缩脚本
├── docs/                  # VitePress 文档站点
└── data/                  # 数据存储目录
```

## 🎯 v1.0.0 版本说明

此版本为纯免费版本：
- ✅ 移除所有付费相关功能
- ✅ 移除用户登录系统
- ✅ 移除后台管理系统
- ✅ 纯 PDF 压缩工具
- ✅ 无任何限制

## 🔒 隐私安全

1. **本地处理**：所有PDF处理在本地完成
2. **临时文件**：文件临时存储，1小时后自动删除
3. **无数据收集**：不收集任何用户数据
4. **不上传第三方**：文件不会上传到任何第三方服务器

## 🚀 部署指南

详细部署指南请查看文档：
- [Mac 服务器部署](https://zijinmengli-svg.github.io/pdf-compress-web/deploy/server)
- [内网穿透](https://zijinmengli-svg.github.io/pdf-compress-web/deploy/network)
- [域名绑定](https://zijinmengli-svg.github.io/pdf-compress-web/deploy/domain)

### 快速部署到公网

使用 ngrok 最简单：

```bash
# 安装 ngrok
brew install ngrok

# 启动隧道
ngrok http 3487
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 📧 联系方式

客服邮箱：zijinnmengli@gmail.com
GitHub：https://github.com/zijinmengli-svg/pdf-compress-web
