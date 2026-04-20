# Mac 服务器部署

## 方案选择

### 方案一：使用自己的 Mac（推荐）

如果你有一台闲置的 Mac：

- **Mac mini**: 理想的服务器选择
- **MacBook**: 可以但需要保持通电
- **iMac**: 性能足够但占用空间

优点：
- 零额外成本
- 完全控制
- 性能足够

### 方案二：租用 Mac 云服务器

推荐服务商：

| 服务商 | 价格（月） | 配置 |
|--------|-----------|------|
| MacinCloud | $49+ | Mac mini |
| MacStadium | $109+ | 多种选择 |
| HostMyApple | $29+ | 入门级 |

优点：
- 24/7 在线
- 专业机房
- 带宽稳定

## 服务器环境配置

### 1. 基础配置

#### 关闭屏幕保护

```bash
# 系统偏好设置 → 桌面与屏幕保护程序 → 屏幕保护程序 → 永不
```

#### 设置电源管理

```bash
# 系统偏好设置 → 节能
# 电池（如果是笔记本）：
#   电脑休眠：永不
#   显示器休眠：10分钟
#   稍候使硬盘进入睡眠：勾选
#   唤醒以供网络访问：勾选

# 电源适配器：
#   电脑休眠：永不
#   显示器休眠：10分钟
#   稍候使硬盘进入睡眠：勾选
#   唤醒以供网络访问：勾选
#   启动后自动重新开机：勾选
```

### 2. 安装项目

```bash
# 克隆代码
cd ~
git clone https://github.com/zijinmengli-svg/pdf-compress-web.git
cd pdf-compress-web

# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start server-simple.js --name pdf-compress

# 设置开机自启
pm2 startup
# 按照提示运行输出的命令

pm2 save
```

### 3. 验证服务

```bash
# 检查状态
pm2 status

# 查看日志
pm2 logs pdf-compress

# 本地测试
curl http://127.0.0.1:3487
```

## 安全配置

### 防火墙

macOS 自带防火墙：

```bash
# 系统偏好设置 → 安全性与隐私 → 防火墙
# 开启防火墙
# 防火墙选项 → 阻止所有传入连接（除了 PDF 压缩服务）
```

### 文件权限

```bash
# 确保项目目录权限安全
chmod 700 ~/pdf-compress-web
chmod 600 ~/pdf-compress-web/server-simple.js
```

## 备份策略

### 定期备份

```bash
# 创建备份脚本 ~/backup-pdf.sh
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf ~/backups/pdf-compress-$DATE.tar.gz ~/pdf-compress-web
# 保留最近7天备份
find ~/backups -name "pdf-compress-*.tar.gz" -mtime +7 -delete
```

添加到 crontab：

```bash
crontab -e
# 每天凌晨2点备份
0 2 * * * ~/backup-pdf.sh
```

## 监控建议

### 使用 PM2 监控

```bash
# 安装 PM2 Plus（可选付费）
# 或使用免费的监控

# 实时监控
pm2 monit
```

### 日志轮转

PM2 自动处理日志轮转，无需额外配置。

## 下一步

- 配置 [内网穿透](./network) 让外网可以访问
- 配置 [域名绑定](./domain) 使用自己的域名
