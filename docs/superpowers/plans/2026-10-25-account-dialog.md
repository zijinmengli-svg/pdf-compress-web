# TinyPDF Account Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改善登录/账户弹窗的视觉层级、账户信息与安全退出交互。

**Architecture:** 保留 `public/email-login.js` 的认证请求和现有会话接口，仅改变前端的视图状态和两个对话框；样式隔离在 `public/email-login.css`。真实浏览器交互由现有 Playwright 测试覆盖。

**Tech Stack:** 原生 HTML/CSS/JS，Node.js 测试与 Playwright。

**Spec:** `docs/superpowers/specs/2026-10-25-account-dialog-design.md`

## Global Constraints

- 不改认证服务端、压缩任务、支付或二级页内容。
- 中英文均需验证；账号 ID 只在已登录状态展示。
- 不自行部署线上。

## Review Focus

- 邮箱、ID 很长时，窄屏卡片不能水平溢出。
- 退出确认取消、关闭、按 Escape，均不能结束会话。
- 跳转二级页前不能误退出。
- 验证码重发倒计时不能让次按钮变成主按钮。
- 登录失败时错误信息可见，登录状态不被伪造。

---

### Task 1: 登录和账户视图

**Files:** `test/email-login-ui.test.js`, `public/email-login.js`, `public/email-login.css`, `public/index.html`, `public/zh/index.html`

**Interfaces:** 使用 `/api/auth/me` 返回的 `{id,email}`；账户菜单链接到 `/contact`、`/privacy`。

- [ ] 写失败浏览器测试：账户 ID/邮箱与链接可见；登录页仅一个主按钮；窄屏无溢出。
- [ ] 运行 `node --test test/email-login-ui.test.js`，确认因功能/样式缺失失败。
- [ ] 修改账户和登录视图、样式、静态资源版本号。
- [ ] 重跑该测试，确认通过。

### Task 2: 退出确认

**Files:** `test/email-login-ui.test.js`, `public/email-login.js`, `public/email-login.css`

**Interfaces:** 只有确认按钮触发已有 `/api/auth/logout`；取消返回账户视图。

- [ ] 写失败浏览器测试：取消保留会话，确认才退出；中英文确认文案。
- [ ] 运行 `node --test test/email-login-ui.test.js`，确认因缺少确认逻辑失败。
- [ ] 实现确认对话框和状态切换。
- [ ] 重跑目标测试与 `npm test`，检查无回归。
