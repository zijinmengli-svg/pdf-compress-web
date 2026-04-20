# 域名绑定

## 购买域名

推荐域名注册商：

| 注册商 | 优势 | 价格（.com） |
|--------|------|-------------|
| 阿里云 | 国内访问快 | ¥55+/年 |
| 腾讯云 | 新用户优惠 | ¥50+/年 |
| Namecheap | 隐私保护好 | $8+/年 |
| Cloudflare | 免费DNS | $9+/年 |

## DNS 配置

### 获取你的访问地址

根据你使用的内网穿透方案：

- **ngrok**: `https://xyz.ngrok-free.app`
- **公网 IP**: `http://123.123.123.123:3487`
- **frp**: `http://你的服务器IP`

### 方案一：CNAME 记录（推荐）

适用于 ngrok、frp 等有域名的情况：

| 记录类型 | 主机记录 | 记录值 |
|---------|---------|--------|
| CNAME | @ | xyz.ngrok-free.app |
| CNAME | www | xyz.ngrok-free.app |

### 方案二：A 记录

适用于有公网 IP 的情况：

| 记录类型 | 主机记录 | 记录值 |
|---------|---------|--------|
| A | @ | 123.123.123.123 |
| A | www | 123.123.123.123 |

## HTTPS 配置

### 使用 ngrok（最简单）

ngrok 免费版自动提供 HTTPS：

```
https://xyz.ngrok-free.app
```

### 使用 Cloudflare（推荐）

1. 域名转到 Cloudflare DNS
2. 在 Cloudflare 开启：
   - SSL/TLS → Full
   - Always Use HTTPS → On
   - Automatic HTTPS Rewrites → On

### 使用 Let's Encrypt

如果你有公网 IP，可以用 Certbot：

```bash
# 安装 certbot
brew install certbot

# 获取证书
sudo certbot certonly --standalone -d yourdomain.com

# 证书位置
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

注意：简化版 server-simple.js 不支持 HTTPS，需要配置反向代理。

## 使用 Nginx 反向代理

### 安装 Nginx

```bash
brew install nginx
```

### 配置 Nginx

编辑 `/usr/local/etc/nginx/nginx.conf`：

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL 证书（Cloudflare 或 Let's Encrypt）
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3487;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（SSE）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

启动 Nginx：

```bash
brew services start nginx
# 或
sudo nginx
```

重启配置：

```bash
sudo nginx -s reload
```

## 验证配置

### 1. 检查 DNS 解析

```bash
nslookup yourdomain.com
# 或
dig yourdomain.com
```

### 2. 测试 HTTP 访问

```bash
curl -I http://yourdomain.com
```

### 3. 测试 HTTPS 访问

```bash
curl -I https://yourdomain.com
```

### 4. 浏览器测试

在浏览器访问你的域名，确认：
- 可以正常打开
- PDF 上传功能正常
- 压缩功能正常
- 下载功能正常

## 推荐配置示例

### 完整方案：Cloudflare + ngrok

1. 在 Namecheap 购买域名
2. DNS 转到 Cloudflare
3. 使用 ngrok 内网穿透
4. Cloudflare CNAME 到 ngrok 域名
5. 开启 Cloudflare HTTPS

优点：
- 配置简单
- 免费 HTTPS
- CDN 加速
- DDoS 防护

## 常见问题

### Q: DNS 多久生效？

A: 通常 5-10 分钟，最长可能 48 小时。

### Q: 可以用多个域名吗？

A: 可以，在 DNS 配置多条记录即可。

### Q: 如何重定向 www 到裸域名？

A: 在 Cloudflare 或 Nginx 中配置重定向规则。
