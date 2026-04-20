# 常见问题

## 使用问题

### Q: 为什么压缩后文件没有变小？

A: 可能原因：
- PDF 已经是高度压缩过的
- PDF 主要是文字且已优化
- 目标大小设置得太大

建议：尝试设置更小的目标大小。

### Q: 压缩后文件比目标大小还小？

A: 这是正常的。系统会找到不超过目标大小的最佳质量，如果能以更小的文件达到更好的质量，会选择更好的方案。

### Q: 压缩需要多长时间？

A: 取决于：
- 文件大小：10MB → 几秒，100MB → 1-2分钟
- 页面数量：页数越多越慢
- 图片数量：图片越多越慢
- Mac 性能：配置越高越快

### Q: 可以批量压缩多个文件吗？

A: v1.0.0 版本暂不支持批量压缩，只能一次处理一个文件。

### Q: 压缩后的 PDF 打不开？

A: 可能原因：
- 原 PDF 有密码保护
- 原 PDF 已损坏
- 压缩过程被中断

尝试用其他工具打开原 PDF 确认是否正常。

### Q: 压缩后出现空白页？

A: 可能原因：
- PDF 使用了特殊字体
- PDF 有复杂的矢量图形
- PDF 有加密

这是 macOS PDFKit 的限制，暂时无法解决。

## 技术问题

### Q: 为什么只支持 macOS？

A: PDF 压缩使用了 macOS 独有的 PDFKit 和 QuartzFilter 框架，这些在 Windows/Linux 上不可用。

### Q: 会有 Windows/Linux 版本吗？

A: 目前没有计划。可以考虑：
- 使用虚拟机运行 macOS
- 使用其他跨平台 PDF 压缩工具

### Q: 可以在 iOS/iPadOS 上运行吗？

A: 不可以。需要 Node.js 环境和 Swift 编译器。

### Q: Swift 编译失败怎么办？

A: 确认已安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

如果还是失败，尝试：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### Q: 端口被占用怎么办？

A: 修改端口：

```bash
PORT=3488 node server-simple.js
```

或查找并结束占用进程：

```bash
lsof -ti:3487 | xargs kill -9
```

## 部署问题

### Q: 可以部署到 Vercel/Netlify 吗？

A: 不可以。这些平台是 Serverless，不支持：
- 长期运行的 Node.js 服务
- Swift 编译和运行
- macOS 环境

### Q: 可以部署到 Docker 吗？

A: 可以，但 Docker 容器内仍需运行 macOS。macOS 容器比较特殊且需要正版 macOS。

### Q: 如何让服务开机自启？

A: 使用 PM2：

```bash
pm2 startup
pm2 save
```

或使用 launchd（macOS）。

### Q: 如何备份数据？

A: v1.0.0 版本不存储持久化数据，无需备份。

### Q: 如何查看访问日志？

A: 使用 PM2：

```bash
pm2 logs pdf-compress
```

或查看系统日志。

## 安全问题

### Q: 上传的文件会被保存吗？

A: 文件会临时保存到系统临时目录，1小时后自动删除。

### Q: 文件会上传到第三方服务器吗？

A: 不会。所有处理在你的服务器本地完成。

### Q: 需要配置防火墙吗？

A: 建议配置，只开放必要的端口。

### Q: 如何限制访问？

A: 几种方式：
- 配置防火墙规则
- 在路由器中限制 IP
- 使用 Nginx 做访问控制

## 功能建议

### Q: 会增加付费功能吗？

A: v1.0.0 是纯免费版本。后续版本可能会重新引入付费功能作为可选项。

### Q: 可以自定义压缩算法吗？

A: 目前不支持。可以修改 Swift 源码自己编译。

### Q: 会增加 PDF 合并/拆分功能吗？

A: 目前没有计划。本工具专注于 PDF 压缩。

### Q: 如何提交功能建议？

A: 通过 GitHub Issues 提交，或联系客服邮箱。

## 联系我们

客服邮箱：zijinnmengli@gmail.com

GitHub：https://github.com/zijinmengli-svg/pdf-compress-web
