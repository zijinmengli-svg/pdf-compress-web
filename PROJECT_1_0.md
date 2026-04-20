# PDF 压缩网站 1.0

## 后端目录结构

```text
pdf-compress-web/
├── package.json
├── server.js
├── start.command
├── PROJECT_1_0.md
├── data/
│   ├── settings.json
│   └── analytics.json
├── scripts/
│   ├── compress_pdf.swift
│   └── inspect_pdf.swift
├── public/
│   ├── index.html
│   ├── app.js
│   ├── admin.html
│   ├── admin.js
│   ├── styles.css
│   ├── privacy.html
│   ├── terms.html
│   ├── contact.html
│   └── faq.html
└── .build/
    ├── compress-pdf
    └── inspect-pdf
```

## API 路由设计

### 公共接口

`GET /api/health`
- 用途：健康检查

`GET /api/config`
- 用途：获取前台配置
- 返回：免费次数、套餐、收款方式、客服信息、文件上限、清理时间

`POST /api/track`
- 用途：记录前台埋点
- 支持事件：
  `page_visit`
  `upload_click`
  `upload_success`
  `upload_failure`
  `target_size_input`
  `download_click`
  `package_view`
  `purchase_click`
  `support_click`

`POST /api/jobs`
- 用途：上传 PDF 并发起压缩
- 入参：
  `pdf` multipart file
  `targetMB` number
- 返回：
  `id`
  `status`
  `originalBytes`
  `targetBytes`
  `downloadExpiresAt`
  `config`

`GET /api/jobs/:id`
- 用途：查询任务状态
- 返回：
  `status`
  `progress`
  `message`
  `originalBytes`
  `targetBytes`
  `resultBytes`
  `ratio`
  `hitTarget`
  `downloadName`
  `downloadExpiresAt`

`GET /api/jobs/:id/events`
- 用途：SSE 推送压缩进度

`GET /api/jobs/:id/download`
- 用途：下载压缩结果
- 说明：链接在配置的临时保留时间内有效

`POST /api/payments/manual-unlock`
- 用途：人工支付后为当前设备补充次数或时长
- 入参：
  `packageId`

`POST /api/refunds/request`
- 用途：用户提交手动退费申请
- 入参：
  `contactEmail`
  `paymentAccount`
  `paymentName`
  `packageName`
  `amountCny`
  `reason`

`POST /api/admin/refunds/:id/refund`
- 用途：后台将某笔退款标记为已人工退费
- 说明：该接口记录退款处理结果，实际打款由管理员线下执行并退回用户填写的支付账户

### 管理后台接口

`POST /api/admin/login`
- 用途：管理员登录

`POST /api/admin/logout`
- 用途：退出后台

`GET /api/admin/session`
- 用途：检查后台登录态

`GET /api/admin/overview`
- 用途：获取仪表盘、访客、事件、异常任务记录

`GET /api/admin/settings`
- 用途：获取后台配置

`POST /api/admin/settings`
- 用途：保存后台配置
- 配置项：
  站点名称
  管理员账号
  新密码
  最大文件大小
  文件保留时间
  压缩超时
  免费次数开关
  免费次数上限
  免费次数重置规则
  收费开关
  套餐列表
  收款方式列表
  客服邮箱
  客服说明

`GET /api/admin/export`
- 用途：导出 Excel 兼容 `.xls` 统计表

## 数据表设计

当前 1.0 使用 JSON 落盘，后续可平移到 SQLite / PostgreSQL。

### settings

| 字段 | 类型 | 说明 |
|---|---|---|
| siteName | string | 站点名称 |
| adminUsername | string | 后台账号 |
| adminPasswordHash | string | 后台密码哈希 |
| maxUploadMB | number | 最大上传大小 |
| cleanupMinutes | number | 文件保留分钟数 |
| compressionTimeoutSeconds | number | 压缩超时秒数 |
| freeUsageEnabled | boolean | 是否开启免费次数 |
| freeUsageLimit | number | 免费次数上限 |
| freeUsageResetMode | enum | `daily` / `lifetime` |
| billingEnabled | boolean | 收费开关 |
| packages | array | 套餐配置 |
| paymentMethods | array | 收款方式配置 |
| supportEmail | string | 客服邮箱 |
| supportMessage | string | 客服说明 |

### visitors

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 设备标识 |
| firstSeenAt | timestamp | 首次访问时间 |
| lastSeenAt | timestamp | 最近访问时间 |
| firstIp / lastIp | string | 访问 IP |
| userAgent | string | 浏览器标识 |
| quotaUsed | number | 已用免费次数 |
| quotaResetKey | string | 按日重置用日期键 |
| paidCredits | number | 已购次数余额 |
| memberUntil | timestamp/null | 时长权益到期时间 |
| 各类计数字段 | number | PV、上传、压缩、下载、付费点击、客服点击等 |

### events

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 事件 ID |
| visitorId | string | 设备标识 |
| type | string | 事件类型 |
| time | timestamp | 事件时间 |
| ip | string | IP |
| userAgent | string | 浏览器标识 |
| targetMB | number | 目标大小 |
| fileName | string | 文件名 |
| fileBytes | number | 文件大小 |
| jobId | string | 压缩任务 ID |
| message | string | 附加说明 |

### exceptionTasks

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 记录 ID |
| kind | string | 异常类型 |
| time | timestamp | 时间 |
| jobId | string | 任务 ID |
| fileName | string | 文件名 |
| message | string | 错误说明 |

## 配置项说明

### 收费规则

- `freeUsageEnabled`
- `freeUsageLimit`
- `freeUsageResetMode`
- `billingEnabled`

### 套餐配置

每个套餐包含：
- `id`
- `name`
- `priceCny`
- `description`
- `entitlementType`
- `entitlementValue`
- `buyLink`
- `enabled`

### 收款方式配置

每个收款方式包含：
- `id`
- `name`
- `link`
- `qrCodeUrl`
- `instructions`
- `postPaymentInstructions`
- `enabled`

## 异常码定义

| code | 含义 |
|---|---|
| FILE_EMPTY | 文件为空 |
| FILE_TYPE_INVALID | 格式错误 |
| FILE_TOO_LARGE | 文件过大 |
| PDF_CORRUPTED | 文件损坏 |
| PDF_ENCRYPTED | 文件加密 |
| TARGET_REQUIRED | 未输入目标大小 |
| TARGET_NOT_NUMBER | 非数字 |
| TARGET_NOT_POSITIVE | 小于等于 0 |
| TARGET_NOT_SMALLER | 大于等于原文件大小 |
| TARGET_TOO_SMALL | 目标值过小 |
| FREE_QUOTA_EXHAUSTED | 免费次数已用完 |
| PACKAGE_UNAVAILABLE | 套餐不可用 |
| PROCESS_TIMEOUT | 压缩超时 |
| SERVER_BUSY | 服务器错误 |
| DOWNLOAD_NOT_FOUND | 下载失败 |
| DOWNLOAD_EXPIRED | 下载链接过期 |
| ADMIN_UNAUTHORIZED | 后台未登录 |
| ADMIN_LOGIN_FAILED | 后台登录失败 |
| SUPPORT_EMAIL_REQUIRED | 缺少客服邮箱 |
| PACKAGE_REQUIRED | 收费开启但无套餐 |

## 后台页面结构

### 仪表盘
- PV
- UV
- 上传次数
- 压缩次数
- 成功率
- 下载次数
- 支付入口点击数
- 免费次数触发数

### 基础设置
- 站点名称
- 后台账号
- 后台密码
- 最大文件大小
- 文件清理时间
- 压缩超时

### 免费次数设置
- 免费次数开关
- 免费次数上限
- 按日重置 / 永久累计

### 收费开关设置
- 收费开关

### 套餐配置
- 套餐名称
- 价格
- 说明
- 权益类型
- 权益值
- 购买链接
- 启用状态

### 收款账户配置
- 收款方式名称
- 收款链接
- 二维码地址
- 收款说明
- 支付后联系说明

### 客服信息配置
- 客服邮箱
- 客服说明

### 数据统计
- 访客表
- 事件流水

### 异常任务记录
- 压缩失败
- 请求异常
- 任务创建失败

## 环境变量清单

当前 1.0 需要的环境变量较少：

| 变量 | 默认值 | 说明 |
|---|---|---|
| PORT | 3487 | 服务端口 |
| HOST | 127.0.0.1 | 监听地址 |

## 关键代码文件待创建清单

当前已落地：
- `server.js`
- `scripts/compress_pdf.swift`
- `scripts/inspect_pdf.swift`
- `public/index.html`
- `public/app.js`
- `public/admin.html`
- `public/admin.js`
- `public/privacy.html`
- `public/terms.html`
- `public/contact.html`
- `public/faq.html`
- `public/styles.css`

## 本地开发启动说明

```bash
cd /Users/libin/pdf-compress-web
node server.js
```

打开：

```text
http://127.0.0.1:3487
http://127.0.0.1:3487/admin
```

默认后台账号：
- 用户名：`admin`
- 密码：`admin123456`

## 部署依赖说明

- macOS
- Node.js 24+
- Swift / PDFKit / Quartz

原因：
- 压缩逻辑依赖 `PDFKit + QuartzFilter`
- 当前版本仅适配 macOS 服务器环境

## 待办清单

### P0
- 已完成：单文件 PDF 上传
- 已完成：目标大小校验
- 已完成：压缩接口
- 已完成：结果下载
- 已完成：异常提示补齐

### P1
- 已完成：免费次数控制
- 已完成：收费开关
- 已完成：套餐配置
- 已完成：收款账户配置
- 已完成：用户行为埋点

### P2
- 已完成：后台管理页
- 已完成：统计页
- 已完成：客服入口与静态页面
- 已完成：异常任务记录

### 后续扩展预留
- 自动支付回调
- 订单表
- 用户系统
- 邮件通知
- 问题反馈表单

## 上线前检查清单

- 修改默认后台账号密码
- 配置真实客服邮箱
- 配置至少一个启用中的套餐
- 配置至少一个可用收款方式
- 检查文件清理时间是否符合预期
- 检查最大文件大小是否符合服务器资源
- 检查压缩超时时间是否合理
- 走通上传、压缩、下载链路
- 走通免费次数耗尽后的付费提示链路
- 验证后台配置修改后前台立即生效
- 验证导出 `.xls` 可被 Excel 打开
