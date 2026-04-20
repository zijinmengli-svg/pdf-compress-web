# GitHub 发布指南

## 第一步：创建 GitHub 仓库

1. 访问 https://github.com/new
2. 填写仓库信息：
   - Repository name: `pdf-compress-web` (或你喜欢的名称)
   - Description: `PDF在线压缩工具 - 想多大就多大！`
   - 选择 Public 或 Private
   - **不要**勾选 "Initialize this repository with a README"
3. 点击 "Create repository"

## 第二步：推送本地代码到 GitHub

在项目目录下执行：

```bash
# 添加远程仓库（替换为你的用户名和仓库名）
git remote add origin https://github.com/你的用户名/pdf-compress-web.git

# 推送到 main 分支
git branch -M main
git push -u origin main
```

## 第三步：创建 GitHub Release（发布版本）

### 方式一：通过网页界面

1. 进入你的 GitHub 仓库
2. 点击右侧的 "Releases"
3. 点击 "Draft a new release"
4. 填写发布信息：
   - Choose a tag: `v1.0.0`
   - Release title: `PDF Compress Web v1.0.0`
   - 描述：

```
## PDF压缩神器 v1.0.0

一个功能完整的PDF在线压缩工具，支持按目标大小压缩PDF文件。

### 功能特性
- PDF拖拽/点击上传
- 目标大小压缩
- 实时进度显示
- 后台管理系统
- 免费次数限制
- 付费套餐支持

### 系统要求
- macOS 10.15+
- Node.js 14+
- Xcode Command Line Tools

### 快速开始
```bash
# 克隆仓库
git clone https://github.com/你的用户名/pdf-compress-web.git
cd pdf-compress-web

# 启动服务
./start.command
# 或
node server.js
```

访问 http://127.0.0.1:3487 即可使用
```

5. 点击 "Publish release"

### 方式二：通过命令行

```bash
# 创建标签
git tag -a v1.0.0 -m "Release version 1.0.0"

# 推送标签
git push origin v1.0.0
```

然后在 GitHub 网页中完成发布。

## 第四步：GitHub Pages 静态网站部署（可选）

注意：由于本项目需要 Node.js 后端和 Swift 压缩功能，**无法完全部署到 GitHub Pages**。

但你可以部署一个静态展示页面：

1. 创建 `gh-pages` 分支
2. 只上传 `public/` 目录作为静态展示
3. 在仓库 Settings -> Pages 中启用

## 生产部署建议

由于本项目需要 macOS 环境运行 Swift 脚本，建议：

1. **Mac 服务器**：使用 Mac mini 或 Mac Studio 作为服务器
2. **进程管理**：使用 PM2 管理 Node.js 进程
   ```bash
   npm install -g pm2
   pm2 start server.js --name pdf-compress
   pm2 save
   pm2 startup
   ```
3. **反向代理**：使用 Nginx 处理 SSL 和静态文件
4. **域名**：绑定你的域名

## 项目安全建议

1. 修改默认管理员密码（admin / admin123456）
2. 生产环境使用 HTTPS
3. 定期备份 data/ 目录
4. 限制后台访问 IP

## 下一步

- 查看 README.md 了解详细使用说明
- 访问 /admin 进入后台配置
- 如有问题联系：zijinnmengli@gmail.com
