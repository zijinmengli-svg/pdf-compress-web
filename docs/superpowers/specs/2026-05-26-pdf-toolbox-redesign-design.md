# TinyPDF v1.1.0 设计文档

**版本**：v1.1.0  
**日期**：2026-05-26  
**网站名称**：TinyPDF  
**方案**：在 server-simple.js 上最小化扩展  
**目标用户**：个人办公用户、小微企业用户  
**核心定位**：免费主导、精准压缩、积分驱动、广告变现

---

## 一、本次改版范围（v1.1.0）

**本次做什么：**
- 网站名称改为 TinyPDF（全局替换）
- 积分用完后再次点击压缩，弹出"积分不足"弹窗
- 弹窗内含两个按钮：左"知道了"、右"看广告获取"
- 点击"看广告获取"播放激励广告，完播后获得积分（1次压缩机会）
- 预留 Google AdSense Rewarded Ads、Monetag、Adsterra 三个广告平台接口
- 测试阶段：广告位为空占位 + 5秒倒计时模拟

**本次不做什么：**
- PDF 转 Word 功能（推迟到后续版本）
- 页面整体设计改版（保持现有页面样式不变）
- Figma 设计稿落地（推迟到页面改版版本）

---

## 二、网站名称变更

全局将 "PDF压缩神器" / "PDF Compression Skill" 替换为 **TinyPDF**。

涉及文件：
| 文件 | 修改内容 |
|------|---------|
| `public/index.html` | `<title>`、header 标题、meta description、OG tags |
| `public/styles.css` | 如有硬编码品牌名则替换 |
| `server-simple.js` | `siteName` 默认值、邮件模板中的品牌名 |
| `public/admin.html` | 后台页面标题 |

---

## 三、积分不足弹窗

### 触发时机

用户点击"开始压缩"时，后端返回 `402 INSUFFICIENT_POINTS`，前端展示积分不足弹窗。

现有行为（保持不变）：积分充足时正常压缩；每日有免费次数时不检查积分。

### 弹窗设计

复用现有 modal 样式（`modal-overlay` + `modal-box`），**不新增 CSS 类**，保持现有页面风格一致。

```
┌─────────────────────────────┐
│  积分不足                    │
│                             │
│  每次压缩需要 10 积分，       │
│  当前积分不足。               │
│  看一个广告可获得 10 积分     │
│  （1次压缩机会）。            │
│                             │
│  [   知道了   ] [看广告获取]  │
└─────────────────────────────┘
```

- **知道了**（左，次要按钮）：关闭弹窗，返回上传状态
- **看广告获取**（右，主按钮）：关闭当前弹窗，打开激励广告弹窗

### 涉及文件

- `public/index.html`：新增积分不足弹窗 HTML 结构
- `public/app-simple.js`：监听 402 响应，显示弹窗；按钮事件处理

---

## 四、激励广告系统

### 广告弹窗流程

```
用户点击"看广告获取"
  → 打开激励广告弹窗
  → 广告区域显示（测试阶段：灰色占位框 + "广告加载中"文字）
  → 倒计时5秒开始（进度条 / 秒数显示）
  → 倒计时结束
      → 按钮从"请观看广告..." 变为"领取积分"（可点击）
  → 用户点击"领取积分"
      → POST /api/ads/reward
      → 后端校验 → +10积分
      → 弹窗关闭
      → 前端积分显示更新
      → 自动重新触发压缩流程
```

### 激励广告弹窗设计

```
┌─────────────────────────────┐
│  观看广告获取积分             │
│                             │
│  ┌─────────────────────┐    │
│  │                     │    │
│  │   广告内容区域        │    │
│  │  （300×250 占位）    │    │
│  │                     │    │
│  └─────────────────────┘    │
│                             │
│  观看完成后可领取 10 积分     │
│  ████████░░░░  3秒后可领取  │
│                             │
│        [请观看广告...]       │  ← 倒计时中，置灰不可点
│        [  领取积分  ]        │  ← 倒计时结束后激活
└─────────────────────────────┘
```

### 后端接口

**`POST /api/ads/reward`**

请求头：`Authorization: Bearer <token>`

请求体：
```json
{ "slot_id": "slot_reward", "watch_seconds": 5 }
```

成功响应：
```json
{ "success": true, "points_added": 10, "new_balance": 20 }
```

错误响应：
```json
{ "error": "REWARD_LIMIT_EXCEEDED", "message": "今日领取次数已达上限" }
```

**风控规则：**
- 每用户每日最多通过看广告领取 3 次（30积分 = 3次压缩机会）
- 服务端校验 `watch_seconds >= 5`（防止前端跳过）
- 领取记录写入 `ad_rewards` 表，用于审计和风控

### SQLite 新增表

```sql
CREATE TABLE IF NOT EXISTS ad_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  slot_id TEXT NOT NULL DEFAULT 'slot_reward',
  points_granted INTEGER NOT NULL DEFAULT 10,
  watch_seconds INTEGER,
  created_at INTEGER NOT NULL
);
```

---

## 五、广告平台接口预留

测试阶段使用空占位 + 5秒倒计时。上线前接入以下三个平台之一（或多个），通过后台配置切换。

### 平台列表

| 平台 | 广告类型 | 接入方式 | 回调方式 |
|-----|---------|---------|---------|
| Google AdSense Rewarded Ads | 激励广告 | JS SDK (`adsbygoogle`) | 客户端回调 `onAdRewarded` |
| Monetag | 激励弹窗 / Push | JS SDK | 客户端事件监听 |
| Adsterra | 展示广告 / 激励 | JS SDK / iframe | 客户端回调 |

### 前端接口设计（预留）

`public/app-simple.js` 中定义广告适配器接口，测试阶段为 mock 实现：

```javascript
// 广告适配器接口（测试阶段为 mock）
const AdAdapter = {
  provider: 'mock', // 'mock' | 'adsense' | 'monetag' | 'adsterra'

  // 加载广告
  load(slotId, container) {
    // mock: 显示占位框
    // 真实接入时替换为对应 SDK 调用
  },

  // 开始播放/展示，返回 Promise，resolve 时表示可领取
  play() {
    // mock: 返回5秒后 resolve 的 Promise
    return new Promise(resolve => setTimeout(resolve, 5000));
  }
};
```

后台 `/api/config` 下发 `adProvider` 字段，前端据此选择适配器：
```json
{ "adProvider": "mock" }
```

上线前将 `adProvider` 改为 `"adsense"` / `"monetag"` / `"adsterra"` 并填入对应 SDK 代码即可，**无需修改业务逻辑**。

---

## 六、文件变更清单

| 文件 | 变更内容 |
|------|---------|
| `public/index.html` | 全局替换品牌名为 TinyPDF；新增积分不足弹窗；新增激励广告弹窗 |
| `public/app-simple.js` | 处理 402 响应显示弹窗；广告适配器（mock）；/api/ads/reward 调用；积分显示更新 |
| `server-simple.js` | 品牌名替换；新增 `POST /api/ads/reward` 路由；新增 `ad_rewards` 表初始化；每日领取上限风控 |
| `public/admin.html` | 品牌名替换 |

---

## 七、不在本次范围内（留存备忘）

以下功能设计已完成，待后续版本实施：

- **PDF 转 Word**（pdf2docx 方案，Dockerfile 加装 Python）
- **页面整体改版**（按 Figma 设计稿，待设计稿完成后启动）
- **广告数据埋点与后台统计**（曝光、点击、完播率）
- **后台广告管理 Tab**（配置广告内容、开关控制）
- **积分冻结/返还状态机 + 风控L1-L4**（abandon beacon、suspicious_users 表）
