# 内网穿透

## 方案对比

| 方案 | 优点 | 缺点 | 费用 |
|------|------|------|------|
| ngrok | 快速、简单 | 域名随机、限速 | 免费/付费 |
| 花生壳 | 国内速度快 | 需要实名 | 免费/付费 |
| 公网 IP | 稳定、速度快 | 需要运营商支持 | 宽带费 |
| frp | 自定义、免费 | 需要有公网服务器 | 免费 |

## 方案一：ngrok（最快上手）

### 1. 安装 ngrok

访问 [ngrok官网](https://ngrok.com/) 下载，或使用 Homebrew：

```bash
brew install ngrok
```

### 2. 注册账号

1. 访问 https://ngrok.com/signup 注册
2. 获取 Authtoken
3. 验证：

```bash
ngrok config add-authtoken 你的token
```

### 3. 启动隧道

```bash
ngrok http 3487
```

你会看到：

```
Forwarding  https://xyz.ngrok-free.app -> http://localhost:3487
```

现在可以通过 `https://xyz.ngrok-free.app` 访问了！

### 4. 使用 PM2 管理 ngrok

创建 `ngrok.yml` 配置文件：

```yaml
tunnels:
  pdf-compress:
    proto: http
    addr: 3487
    hostname: 你的自定义域名（付费版）
```

启动：

```bash
ngrok start --config ngrok.yml pdf-compress
```

PM2 管理：

```bash
pm2 start "ngrok start --config ~/ngrok.yml pdf-compress" --name ngrok
pm2 save
```

## 方案二：公网 IP（最稳定）

### 1. 获取公网 IP

联系你的宽带运营商：

- 电信：通常可以免费申请
- 联通：部分地区支持
- 移动：较难申请

### 2. 配置路由器

#### 端口转发

登录路由器管理后台（通常是 192.168.1.1 或 192.168.0.1）：

```
外部端口: 3487
内部端口: 3487
内部IP: 你的Mac的局域网IP（如 192.168.1.100）
协议: TCP
```

#### DHCP 静态分配

给你的 Mac 分配固定的局域网 IP，避免 IP 变化。

### 3. 配置 DDNS（如果 IP 动态）

如果公网 IP 会变化，使用 DDNS 服务：

- 花生壳
- 公云
- 路由器自带 DDNS

### 4. 测试访问

```bash
# 查看公网 IP
curl ifconfig.me

# 从外网访问
http://你的公网IP:3487
```

## 方案三：frp（需要有公网服务器）

如果你有一台有公网 IP 的服务器（如阿里云、腾讯云），可以用 frp。

### 服务端配置（公网服务器）

```bash
# 下载 frp
wget https://github.com/fatedier/frp/releases/download/v0.52.3/frp_0.52.3_linux_amd64.tar.gz
tar -xzf frp_0.52.3_linux_amd64.tar.gz
cd frp_0.52.3_linux_amd64

# 编辑 frps.toml
bindPort = 7000
vhostHTTPPort = 80
```

启动服务端：

```bash
./frps -c frps.toml
```

### 客户端配置（你的 Mac）

```bash
# 下载 frp for macOS
# 编辑 frpc.toml
serverAddr = "你的服务器IP"
serverPort = 7000

[[proxies]]
name = "pdf-compress"
type = "http"
localPort = 3487
customDomains = ["你的域名"]
```

启动客户端：

```bash
./frpc -c frpc.toml
```

## 安全建议

无论使用哪种方案：

1. **不要对外暴露 admin 页面**（如果使用完整版）
2. **使用 HTTPS**（ngrok 自动提供，其他方案需要配置证书）
3. **限制访问频率**（可在路由器或服务器配置）
4. **定期检查访问日志**

## 下一步

- 配置 [域名绑定](./domain) 使用自己的域名
