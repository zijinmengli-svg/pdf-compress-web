# 部署检查清单

## 发布前检查

### [ ] 1. 基础配置
- [ ] 修改默认管理员密码（admin123456）
- [ ] 配置正确的站点名称
- [ ] 设置合适的文件大小限制（maxUploadMB）
- [ ] 配置文件保留时间（cleanupMinutes）
- [ ] 设置压缩超时时间（compressionTimeoutSeconds）

### [ ] 2. 免费/付费配置
- [ ] 决定是否开启免费使用（freeUsageEnabled）
- [ ] 配置免费次数上限（freeUsageLimit）
- [ ] 选择免费次数统计规则（daily/lifetime）
- [ ] 决定是否开启收费功能（billingEnabled）

### [ ] 3. 套餐配置
- [ ] 添加/编辑付费套餐
- [ ] 配置套餐价格（priceCny）
- [ ] 设置套餐权益类型（credit_pack/duration_days）
- [ ] 配置套餐权益值（entitlementValue）
- [ ] 添加购买链接（buyLink）
- [ ] 启用需要的套餐

### [ ] 4. 收款方式配置
- [ ] 添加收款方式（支付宝/微信等）
- [ ] 配置收款链接（link）
- [ ] 上传收款二维码（qrCodeUrl）
- [ ] 编写收款说明（instructions）
- [ ] 编写支付后联系说明（postPaymentInstructions）
- [ ] 启用需要的收款方式

### [ ] 5. 客服信息
- [ ] 配置客服邮箱（supportEmail）
- [ ] 编写客服说明（supportMessage）

### [ ] 6. SEO和网站文件
- [ ] 更新index.html中的OG标签URL（example.com改为实际域名）
- [ ] 更新sitemap.xml中的URL
- [ ] 更新robots.txt中的Sitemap URL
- [ ] 更新index.html中的canonical链接
- [ ] 准备网站favicon（favicon.ico）
- [ ] 准备网站logo（如需要）

### [ ] 7. 服务器配置
- [ ] 配置正确的端口（PORT环境变量）
- [ ] 配置监听地址（HOST环境变量）
- [ ] 设置防火墙规则
- [ ] 配置HTTPS证书（推荐使用Let's Encrypt）
- [ ] 配置反向代理（Nginx/Apache）

### [ ] 8. 进程管理
- [ ] 配置进程管理器（PM2/systemd）
- [ ] 设置自动重启
- [ ] 配置日志轮转

### [ ] 9. 数据备份
- [ ] 设置data/目录定期备份
- [ ] 测试备份恢复流程
- [ ] 配置备份监控

### [ ] 10. 安全加固
- [ ] 限制/admin路径的访问IP
- [ ] 配置rate limiting
- [ ] 设置安全相关的HTTP headers
- [ ] 定期检查日志异常

### [ ] 11. 测试验证
- [ ] 测试PDF上传功能
- [ ] 测试PDF压缩功能
- [ ] 测试文件下载功能
- [ ] 测试后台登录
- [ ] 测试后台配置保存
- [ ] 测试付费流程（如开启）
- [ ] 测试移动端响应式布局
- [ ] 测试各浏览器兼容性

### [ ] 12. 监控和日志
- [ ] 配置访问日志
- [ ] 配置错误日志
- [ ] 设置关键指标监控
- [ ] 配置告警通知

## 运维日常检查

### 每日检查
- [ ] 检查服务器运行状态
- [ ] 查看错误日志
- [ ] 检查磁盘空间
- [ ] 查看用户统计数据

### 每周检查
- [ ] 备份数据
- [ ] 检查异常任务
- [ ] 查看用户反馈
- [ ] 更新依赖包（安全更新）

### 每月检查
- [ ] 检查SSL证书状态
- [ ] 审查用户数据使用情况
- [ ] 优化配置参数
- [ ] 检查安全公告
