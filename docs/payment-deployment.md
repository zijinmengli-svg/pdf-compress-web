# Paddle 单次付费部署与回滚

## 上线前配置

Render 免费 Web Service 仅负责运行 Docker/Ghostscript；Neon 免费 PostgreSQL 负责持久化订单；Cloudflare R2 负责短期私有付费结果。不要使用 Render 免费 PostgreSQL（该实例有 30 天到期限制）。

在 Render 的 Environment 中配置 `DATABASE_URL`、`PADDLE_API_KEY`、`PADDLE_CLIENT_TOKEN`、`PADDLE_WEBHOOK_SECRET`、`PADDLE_NOTIFICATION_SETTING_ID`、`PADDLE_PRODUCT_ID`、`PADDLE_PRICE_ID`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_ENDPOINT`、`WEB_SESSION_SECRET`、`PAYMENT_IDENTITY_HASH_SECRET`、`PUBLIC_OPERATOR_LEGAL_NAME`、`PADDLE_ENVIRONMENT=sandbox` 和 `BILLING_ENABLED=false`。

邀请奖励使用同一个 Neon `DATABASE_URL`，另配置长期随机的 `REFERRAL_WALLET_SECRET`（未配置时回退使用 `WEB_SESSION_SECRET`）。功能默认关闭：后台登录后进入“邀请奖励”，确认测试通过再打开开关。默认每日有效好友上限为 50，可在后台修改为 0–500；0 表示暂停发奖但不影响压缩。邀请奖励按好友首次成功压缩并下载结算，点击分享不会发奖；每笔奖励独立 90 天到期，匿名钱包 Cookie 保留 365 天。

部署参数固定为 Docker、分支 `feat/paddle-single-payment`、Free 实例。Render Free 会在约 15 分钟无请求后休眠，首次唤醒可能需要约 1 分钟；本地文件系统是临时的，因此后台 JSONL 分析数据在重启/重新部署后不保证保留，订单和收益数据以 Neon 为准。

两个 session/hash 密钥必须是独立、长期保存的随机值；不要在重启时更换。价格默认为 `PAYMENT_USD_MINOR=199` 和 `PAYMENT_CNY_MINOR=990`，均为最小货币单位。

Paddle 中创建产品/一次性价格，配置 webhook 到 `https://tinypdf.cn/api/paddle/webhook`，只订阅 `transaction.created`、`transaction.completed`、`adjustment.created`、`adjustment.updated`。R2 必须为私有桶，并增加 24 小时生命周期规则作为一小时应用清理的兜底。

## 沙盒验收

1. 保持 `BILLING_ENABLED=false` 部署，确认 `/api/config` 中 payment 为 unavailable 或 disabled。
2. 配置完整环境变量后重启，后台支付区应显示“已配置”；数据库会自动迁移，但仍不会开始收费。
3. 先在后台/数据库将 `payment_settings.billing_enabled` 开启，再把环境变量 `BILLING_ENABLED=true`。用 Paddle Sandbox 卡 `4242 4242 4242 4242` 验证第二次压缩：上传、Paddle Overlay、webhook、下载链接和收益事件。
4. 验证首次成功压缩仍免费，机器人无法调用支付 API，支付前下载返回 `PAYMENT_REQUIRED`。
5. 在“邀请奖励”保持关闭时，确认首页不显示分享面板；打开后，用两个普通浏览器会话验证：A 打开带 `?ref=` 的链接，B 首次压缩并下载，后台状态变为“已奖励”，双方各增加 1 次。重复下载不得重复发奖；刷新、关闭并重新打开同一浏览器后次数仍保留。

## 立即回滚

将 Render 的 `BILLING_ENABLED=false` 并重新部署即可停止新付费订单。不要删除 Neon PostgreSQL、R2 或 webhook；已支付订单、退款和清理仍需继续运行。若代码回滚，优先回滚到本次发布前的 Git commit，并保留数据库 migration（迁移仅新增表）。

邀请奖励单独回滚：后台将“开启邀请奖励”关闭，或将每日有效好友上限设为 `0`，即可立即停止新奖励；已有次数不撤回，仍按原到期时间可使用。必要时可将 `REFERRAL_WALLET_SECRET` 保持不变，避免重新部署后同一浏览器钱包失效。

Render Free 的临时磁盘不适合保存订单或付费文件：订单必须写入 Neon，付费结果必须写入 R2。Render 休眠期间不会处理请求；Paddle webhook 在服务唤醒后会被重试，恢复后检查 webhook backlog 和订单状态。

## 运营口径

后台“Paddle 净收益”是 Paddle 的 USD payout earnings，未扣 Payoneer 提现费用、中国个人所得税或汇兑后的银行费用。不同客户币种不相加。
