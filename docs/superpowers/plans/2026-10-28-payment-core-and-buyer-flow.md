# Multi-Product Payment Core and TinyPDF Buyer Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 TinyPDF 邮箱登录基础上完成可复用支付核心与 1/3/5/10 次购买闭环，同时保持收费关闭，直到独立沙盒与正式审核通过。

**Architecture:** 同一个 Node 服务内提供受控商品目录、通用订单/事件状态机和 Paddle 适配层；TinyPDF 以身份与压缩次数适配器接入。静态双语购买页只提交套餐键和数量，最终实付与权益发放由经核验的服务端交易决定。

**Tech Stack:** Node.js CommonJS、原生 HTTP 服务、PostgreSQL、`@paddle/paddle-node-sdk`、静态 HTML/CSS/JavaScript、`node:test`、现有浏览器测试工具。

**Spec:** `docs/superpowers/specs/2026-10-28-multi-product-payment-core-design.md`；TinyPDF 原有规则见 `docs/superpowers/specs/2026-10-27-payment-release-integration-design.md`。

## Global Constraints

- TinyPDF 售卖数量仅为 `1, 3, 5, 10`；当前是一条 Paddle 单价商品的数量，实付数量 `1:1` 发放压缩次数。
- 已验证 `auth_accounts` 会话是 TinyPDF 已购权益的唯一身份；匿名首免费继续使用，不能凭客户端邮箱或账号 ID 授权。
- 仅压缩成功扣一次；失败、超时、目标区间不合格不扣。
- 公开页面中英文同步；已有路由 `/api/credits/*` 保持兼容外观。
- 沙盒与正式环境完全分离，`BILLING_ENABLED` 默认关闭；收费关闭不阻断既有订单查询、Webhook 和退款处理。
- 不做独立支付服务、统一账号中心、多产品购物车、订阅、邀请奖励或第二产品前端。
- 不直接修改生产数据库、真实收费开关或部署线上；生产迁移前先只读核对数据，独立沙盒验收后另作发布决定。

## Review Focus

1. 买家在 Checkout 中改变数量：必须按经 Paddle 核验且仍在受控范围内的实付数量发放；Task 3 测试。
2. 同一邮箱跨设备登录或共用设备切换账号：只显示对应 `auth_accounts` 的订单与余额；Task 4、5 测试。
3. Webhook 重复、乱序或重启后重送：订单与权益只入账一次；Task 3 测试。
4. 付款成功但回调延迟、失败或浏览器关闭：页面显示待确认并可按订单号恢复查询，不假报成功；Task 4、5 测试。
5. Paddle 后台退款、部分退款或未知调整：已付款订单不得继续消费应冻结的权益，异常进入人工核对而非静默丢弃；Task 3 测试。

---

## File Structure

- `lib/payment/catalog.js`：受控 `productKey/offerKey` 注册表和 Paddle 环境价格映射。
- `lib/payment/order-service.js`：创建与读取通用订单、对已付款交易做绑定核验及幂等履约。
- `lib/payment/payment-schema.sql`：通用订单/事件表和唯一约束；保留 TinyPDF 次数账本。
- `lib/payment/job-reservations.js`：TinyPDF 压缩任务的次数预留、成功结算与失败释放；避免并行任务透支。
- `lib/payment/tinypdf-adapter.js`：已验证 TinyPDF 身份、钱包及发放/撤销次数的适配。
- `lib/payment/credit-purchase.js`：兼容原有购买接口，逐步委托核心；不再持有通用支付规则。
- `lib/payment/prepaid-webhook-worker.js`、`prepaid-runtime.js`、`prepaid-routes.js`、`config.js`、`server-simple.js`：接入核心、对外路由、关闭开关和后台处理。
- `public/buy.html`、`public/zh/buy.html`、`public/buy.js`、`public/buy.css`：双语购买、状态和订单视图。
- `public/index.html`、`public/zh/index.html`、`public/email-login.js`、`public/sketch-ui.css`：购买入口、实际余额及登录状态事件。
- 对应测试置于 `test/payment-*.test.js`、`test/buy-ui.test.js`；沿用现有 `test/prepaid-*.test.js` 回归。

### Task 1: 商品目录与通用订单持久化

**Files:** Create `lib/payment/catalog.js`, `lib/payment/payment-schema.sql`, `test/payment-catalog.test.js`, `test/payment-schema.test.js`; modify `lib/payment/database.js`, `lib/payment/config.js`.

**Interfaces:** `createCatalog({environment, products})` 输出 `resolveOffer({productKey,offerKey,quantity}) -> {productKey,offerKey,priceId,productId,quantity,entitlementUnits}`；`createOrderRepository({pool})` 由 Task 3 在 `order-service.js` 实现，表为 `payment_orders` 与 `payment_order_events`。TinyPDF 适配器在 Task 2 注册 `tinypdf/compression-credit`，允许数量 `[1,3,5,10]`。

- [ ] **Step 1: 写失败测试**：合法 TinyPDF 数量返回同一价格 ID 及相等权益单位；未知产品/套餐、数量 0/2/负数、环境错误和缺失价格 ID 均抛错；迁移重跑不覆盖已插入订单，交易唯一约束包含 provider/environment。
- [ ] **Step 2: 运行测试确认失败**：`node --test test/payment-catalog.test.js test/payment-schema.test.js`，预期缺模块或断言失败。
- [ ] **Step 3: 实现目录、订单表和迁移顺序**：服务端只接受注册商品；表记录订单号、产品、套餐、subject namespace/ID、数量/价格快照、provider/environment/transaction ID、金额币种、履约/退款状态及时间戳。
- [ ] **Step 4: 运行上述测试和 `node --test test/prepaid-migrations.test.js`，预期全通过。**
- [ ] **Step 5: 提交 `feat: add product catalog and payment order schema`。**

### Task 2: TinyPDF 身份与权益适配器

**Files:** Create `lib/payment/tinypdf-adapter.js`, `test/payment-tinypdf-adapter.test.js`; modify `lib/payment/prepaid-ledger.js`, `lib/payment/credit-purchase.js` only to separate TinyPDF-specific logic.

**Interfaces:** `createTinyPdfAdapter({pool,authService,ledger,identityHashSecret})` 输出 `resolveSubject(sessionToken) -> {namespace:'tinypdf',id:accountId,walletHash}`、`grant({orderId,transactionId,subject,units,tx})`、`refundEligibility({orderId,transactionId,units,tx})`、`freezeUnused(...)`、`restoreFrozen(...)`。Task 3 调用这些方法；`grant` 以订单/交易来源键去重。

- [ ] **Step 1: 写失败测试**：无有效会话拒绝；同账号跨设备相同钱包；不同账号不同钱包；支付一次发放一次；两个订单各有独立来源包；只检查本订单未使用数量决定自动退款资格；消费顺序沿用到期时间和创建时间升序。
- [ ] **Step 2: 运行 `node --test test/payment-tinypdf-adapter.test.js` 确认失败。**
- [ ] **Step 3: 实现适配器并保留现有 `reward_ledger` 语义，不将未来产品强制接入次数钱包。**
- [ ] **Step 4: 运行新测试与 `node --test test/prepaid-ledger.test.js test/account-wallet.test.js`，预期全通过。**
- [ ] **Step 5: 提交 `feat: isolate TinyPDF payment identity and entitlements`。**

### Task 3: 核心订单、Paddle 履约与退款状态

**Files:** Create `lib/payment/order-service.js`, `test/payment-order-service.test.js`; modify `lib/payment/prepaid-webhook-worker.js`, `lib/payment/credit-purchase.js`, `lib/payment/prepaid-webhook-repository.js`, `lib/payment/prepaid-schema.sql` as needed.

**Interfaces:** `createOrderService({pool,catalog,adapters,intentSecret,paddle,now})` 输出 `prepareCheckout({productKey,offerKey,quantity,subject}) -> {orderId,priceId,quantity,customData}`、`settleCompleted(remoteTransaction)`、`getOrder({orderId,subject})`、`requestRefund({orderId,reason,adminActor})`、`applyAdjustment({adjustment,transaction})`。`customData` 仅保存签名订单引用，不作为付款证明。

- [ ] **Step 1: 写失败测试**：两个模拟产品不能串权益；错商品/价格/环境/subject、伪造签名、数量越界和非 completed 交易拒绝；实付数量变化 1→3 时只发放 3；重复/乱序事件只履约一次；外部整单退款冻结本包，部分退款和未知调整进入人工状态；退款拒绝后可幂等恢复，已使用部分不自动全退。
- [ ] **Step 2: 运行 `node --test test/payment-order-service.test.js` 确认失败。**
- [ ] **Step 3: 实现订单服务并改 Webhook worker 委托它；仍使用 Paddle SDK 验签原始请求与服务端交易核验，实际金额允许税费/折扣变化但必须为正且币种有效。**
- [ ] **Step 4: 运行新测试与 `node --test test/canonical-purchase.test.js test/prepaid-webhook.test.js test/prepaid-webhook-repository.test.js`，预期全通过。**
- [ ] **Step 5: 提交 `feat: settle reusable payment orders and refunds`。**

### Task 4: HTTP 运行时与账户购买 API

**Files:** Create `lib/payment/job-reservations.js`, `test/payment-job-reservations.test.js`, `test/payment-server.test.js`; modify `lib/payment/prepaid-runtime.js`, `lib/payment/prepaid-routes.js`, `lib/payment/prepaid-schema.sql`, `lib/payment/config.js`, `server-simple.js`.

**Interfaces:** 保留 `/api/credits/purchase-intent`、`/api/credits/purchase-status`、`/api/credits/purchases`；新增 `GET /api/credits/balance` 和 `GET /api/credits/orders/:orderId`（精确路径可按现有路由解析约束调整）。`/api/config` 增加安全的公开支付配置。购买意图返回 `orderId,priceId,quantity,customData`，状态返回 `pending/completed/refund_pending/refunded/review` 和实付摘要；所有用户查询从服务端会话解析 subject。`reserveJob({walletHash,jobId})`、`settleSuccessfulJob({walletHash,jobId})`、`releaseJob({walletHash,jobId})` 在数据库中保证一个有效次数不会同时承诺给两个任务。

- [ ] **Step 1: 写失败测试**：未登录不能购买/读账号订单；关闭收费时不能新购但可查历史；Web token/同源校验延续；两账户不得互读；运行时未配置则 503；Webhook 在关闭新购时仍可处理旧交易；支付成功但尚未履约显示 pending；同一余额同时启动两个任务只允许一个预留；失败/超时/低于目标区间释放，符合目标的成功任务仅扣一次。
- [ ] **Step 2: 运行 `node --test test/payment-server.test.js test/payment-job-reservations.test.js` 确认失败。**
- [ ] **Step 3: 将运行时在凭据和数据库就绪时安全初始化，分开“处理既有订单”与“允许新购买”开关；未就绪失败关闭，不输出凭据。按服务端钱包余额在任务创建时预留、成功时结算、其他终态释放；游客欢迎次数仅依稳定匿名钱包赠送一次。**
- [ ] **Step 4: 运行新测试与 `node --test test/prepaid-routes.test.js test/prepaid-server.test.js test/prepaid-webhook-route.test.js`，预期全通过。**
- [ ] **Step 5: 提交 `feat: expose account-bound payment APIs behind billing switch`。**

### Task 5: 双语购买流程与余额入口

**Files:** Create `public/buy.html`, `public/zh/buy.html`, `public/buy.js`, `public/buy.css`, `test/buy-ui.test.js`; modify `public/index.html`, `public/zh/index.html`, `public/email-login.js`, `public/sketch-ui.css`, `public/pricing.html`.

**Interfaces:** 页面调用 Task 4 API；登录组件成功/退出时发 `tinypdf:auth-changed` 事件，购买页与首页刷新余额；仅 `config.enabled` 且已登录时打开 Paddle Checkout，传服务端返回的 `priceId,quantity,customData`。成功回调只进入订单待确认视图并轮询服务端状态。

- [ ] **Step 1: 写失败测试**：两语言均展示 1/3/5/10 选择与实际总价说明；换数量按钮文字同步；未登录可打开登录；收费关闭时无可点击支付按钮；付款取消/失败不加余额；回调延迟显示订单号和待确认；已完成显示 `txn_` 与余额；刷新可从订单号恢复；首页不再硬编码“剩余 3 次”；窄屏不横向溢出。
- [ ] **Step 2: 运行 `node --test test/buy-ui.test.js` 确认失败。**
- [ ] **Step 3: 按现有深色视觉实现购买页和入口；同步修订定价页旧的“购买结果”文案，实际金额/支付方式以 Paddle Checkout 为准。**
- [ ] **Step 4: 运行 UI 测试与 `node --test test/email-login-ui.test.js test/i18n.test.js`；用浏览器在桌面和手机宽度做截图及交互验收。**
- [ ] **Step 5: 提交 `feat: add bilingual TinyPDF credit checkout flow`。**

### Task 6: 总回归与交付闸门

**Files:** Modify `docs/qa/2026-10-27-payment-release-preflight.md` or add dated后续验收记录；test files as gaps are found.

**Interfaces:** 不修改对外接口；输出已验证/未验证清单与沙盒所需配置，不在本任务开启正式收费。

- [ ] **Step 1: 运行 `npm test`，修复本计划引入的失败。**
- [ ] **Step 2: 使用隔离本地 PostgreSQL 两次迁移、重启、并发结算和账号切换测试；无法取得隔离库时明确记录为未验收，不触碰生产库。**
- [ ] **Step 3: 若沙盒密钥/端点可用，跑真实 Paddle 沙盒 1/3/5/10 购买、延迟 Webhook、取消和退款；若不可用，记录缺口并保持 `BILLING_ENABLED=false`。**
- [ ] **Step 4: 审核双语页面截图、静态定价文案和生产收费开关仍关闭；提交 `test: record payment readiness gates`。**
