# PDF 压缩神器 - 网站工具

一个功能完整的PDF在线压缩工具网站，支持按目标大小压缩PDF文件。

## 功能特性

### 前台功能
- 📄 **PDF上传**：支持拖拽和点击上传PDF文件
- 🎯 **目标大小压缩**：输入期望的文件大小，自动压缩到目标大小
- 📊 **实时进度**：显示压缩进度和压缩结果
- 💾 **一键下载**：压缩完成后直接下载文件
- 💰 **付费系统**：支持免费次数限制和付费套餐

### 后台管理
- 🔐 **管理员登录**：安全的后台管理入口
- ⚙️ **网站配置**：配置网站名称、上传限制、免费次数等
- 💳 **套餐管理**：配置付费套餐和收款方式
- 📈 **数据统计**：查看访客数据、使用统计和事件记录
- 📋 **异常监控**：记录压缩失败和异常任务
- 💸 **退费处理**：处理用户退费申请

## 技术栈

- **后端**：Node.js + Express风格原生HTTP服务器
- **前端**：原生HTML/CSS/JavaScript
- **PDF压缩**：Swift + PDFKit + QuartzFilter (macOS专用)
- **数据存储**：JSON文件存储

## 系统要求

- **操作系统**：macOS 10.15或更高版本
- **Node.js**：v14或更高版本
- **Swift**：Xcode Command Line Tools

## 安装和部署

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

# 启动服务器
./start.command

# 或手动启动
node server.js
```

### 3. 访问网站

- 前台：http://127.0.0.1:3487
- 后台：http://127.0.0.1:3487/admin

### 默认管理员账号

- 用户名：`admin`
- 密码：`admin123456`

**⚠️ 重要：请立即修改默认密码！**

## 配置说明

### 后台配置项

1. **基础设置**
   - 站点名称
   - 单文件最大支持（MB）
   - 文件保留时间（分钟）
   - 压缩超时（秒）

2. **免费次数与收费**
   - 开启/关闭免费次数控制
   - 免费次数上限
   - 免费次数统计规则（按日重置/永久累计）
   - 开启/关闭收费功能

3. **套餐配置**
   - 套餐名称
   - 价格
   - 权益类型（次数包/会员时长）
   - 购买链接

4. **收款方式**
   - 收款方式名称
   - 收款链接
   - 二维码地址
   - 收款说明

## 项目结构

```
pdf-compress-web/
├── server.js                 # Node.js服务器主文件
├── package.json              # 项目配置
├── start.command             # 快速启动脚本
├── README.md                 # 项目说明文档
├── public/                   # 前端静态文件
│   ├── index.html           # 前台首页
│   ├── admin.html           # 后台管理页
│   ├── app.js               # 前台逻辑
│   ├── admin.js             # 后台逻辑
│   ├── styles.css           # 样式文件
│   ├── privacy.html         # 隐私政策
│   ├── terms.html           # 用户协议
│   ├── contact.html         # 联系我们
│   └── faq.html             # 常见问题
├── scripts/                  # Swift压缩脚本
│   ├── compress_pdf.swift   # PDF压缩脚本
│   ├── rasterize_pdf.swift  # PDF光栅化脚本
│   └── inspect_pdf.swift    # PDF检查脚本
├── .build/                   # 编译后的Swift二进制文件
└── data/                     # 数据存储目录
    ├── settings.json        # 网站配置
    └── analytics.json       # 统计数据
```

## 安全建议

1. **修改默认密码**：首次登录后立即修改管理员密码
2. **使用HTTPS**：生产环境部署时使用HTTPS
3. **备份数据**：定期备份`data/`目录下的JSON文件
4. **限制访问**：使用防火墙或反向代理限制后台访问IP
5. **文件上传**：已限制仅PDF文件上传，确保配置合适的文件大小限制

## 生产部署建议

1. 使用进程管理器（如PM2）管理Node.js进程
2. 配置反向代理（如Nginx）处理静态文件和SSL
3. 设置日志轮转和监控
4. 配置定时备份数据目录

## 常见问题

**Q: 为什么只能在macOS上运行？**
A: PDF压缩功能使用了macOS专用的PDFKit和QuartzFilter框架。

**Q: 如何修改端口？**
A: 设置环境变量`PORT`，例如：`PORT=8080 node server.js`

**Q: 压缩后的文件在哪里？**
A: 压缩文件存储在系统临时目录中，会在配置的保留时间后自动清理。

## 许可证

本项目仅供学习和个人使用。

## 联系方式

客服邮箱：zijinnmengli@gmail.com
