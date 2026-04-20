# 安装部署

## 快速开始

### 1. 获取代码

```bash
git clone https://github.com/zijinmengli-svg/pdf-compress-web.git
cd pdf-compress-web
```

### 2. 启动服务

```bash
# 使用简化版本（推荐）
node server-simple.js
```

看到以下输出表示启动成功：

```
PDF compress web app running at http://127.0.0.1:3487
```

### 3. 访问应用

打开浏览器访问：http://127.0.0.1:3487

## 使用 PM2 管理（推荐）

### 安装 PM2

```bash
npm install -g pm2
```

### 启动服务

```bash
pm2 start server-simple.js --name pdf-compress
```

### 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs pdf-compress

# 重启
pm2 restart pdf-compress

# 停止
pm2 stop pdf-compress

# 开机自启
pm2 startup
pm2 save
```

## 配置选项

### 端口配置

使用环境变量指定端口：

```bash
PORT=8080 node server-simple.js
```

### 主机配置

```bash
HOST=0.0.0.0 node server-simple.js
```

## 目录结构

```
pdf-compress-web/
├── server-simple.js      # 简化版服务器（推荐使用）
├── server.js             # 完整版服务器（含付费功能）
├── public/               # 前端文件
│   ├── index-simple.html # 简化版首页
│   ├── app-simple.js     # 简化版脚本
│   └── styles.css        # 样式文件
├── scripts/              # Swift 压缩脚本
├── docs/                 # VitePress 文档
└── data/                 # 数据目录（.gitkeep）
```

## 下一步

- 阅读 [使用说明](./usage) 了解如何压缩 PDF
- 查看 [部署指南](../deploy/server) 了解如何部署到公网
