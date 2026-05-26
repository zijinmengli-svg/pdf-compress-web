# PDF工具箱 商业化重构设计文档

**日期**：2026-05-26  
**方案**：A（在 server-simple.js 上扩展）  
**目标用户**：个人办公用户、小微企业用户  
**核心定位**：免费主导、广告变现、精准压缩 + PDF转Word 双功能

---

## 一、整体页面结构

基于用户提供的 UI 原型（pdf_tool_website_ui_prototype_cn (2).jsx）重构前端。

### 布局

```
Header: PDF工具箱 · 积分徽章 · 登录按钮 · API接入 · 联系合作
─────────────────────────────────────────────────────────
主工具区（左）                        右侧栏（sticky）
  纯净模式切换按钮（右上角）            正常模式：广告位1 + 广告位2 + Pro推广
  标题 + 描述                          纯净模式：网站特点 + 累计统计
  上传区（拖拽/点击）
  功能切换：精准压缩 / PDF转Word
  参数区（压缩：目标大小；转Word：无需配置）
  操作按钮（开始压缩 / 开始转换）
  进度卡片（处理中 → 完成 → 下载）
  积分不足卡片（看广告得积分 / 兑换码）
─────────────────────────────────────────────────────────
底部3栏联盟广告（正常模式显示，纯净模式隐藏）
Footer: 隐私政策 · 用户协议 · 联系我们
```

### 纯净模式

- 用户主动点击"开启无广告纯净模式"触发
- 状态存入 `localStorage`，刷新保持
- 右侧栏切换为：网站特点 + 统计数字
- 底部联盟广告区隐藏
- 不影响功能和积分逻辑

### 文件变更

| 文件 | 操作 |
|------|------|
| `public/index.html` | 全量重写，按新原型结构 |
| `public/styles.css` | 重写为新设计系统（圆角卡片、中性色调） |
| `public/app.js` | 原 app-simple.js 重命名并扩展，新增转Word + 广告逻辑 |

---

## 二、积分系统（扩展现有）

### 现有逻辑（保持不变）

- 新用户注册赠 10 积分
- 邮箱验证 + Resend 发送验证码
- 每次操作消耗 10 积分
- 每日免费1次（压缩和转Word合计，不分别计算）
- 兑换码系统

### 积分扣减状态机

```
用户点击"开始" 
  → 检查每日免费次数
      ├─ 有免费次数 → 直接开始，不动积分
      └─ 无免费次数 → 检查积分 ≥ 10
            ├─ 积分不足 → 显示"积分不足"卡片
            └─ 积分充足 → 冻结10积分（frozen_points字段标记）→ 任务开始

任务结果：
  done（有文件输出）→ 正式扣减，解冻
  failed（服务端错误）→ 解冻返还，前端提示"积分已返还，请刷新重试"
  abandoned（用户刷新/关闭）→ 检查任务状态：
      ├─ processing → 终止进程，删文件，返还积分
      ├─ done 且已下载 → 不返还
      └─ done 未下载 → 不返还，文件保留60分钟可重新下载
```

### 看广告得积分流程

```
积分不足卡片 → 点击"看广告得积分"
  → 弹出广告模态框（占位广告内容，预留 AdSense/穿山甲 SDK 接入口）
  → 倒计时5秒（前端计时）
  → 完播 → POST /api/ads/reward → 后端+10积分
  → 关闭弹窗 → 自动继续任务
```

### SQLite 新增字段和表

**jobs 表（新增字段）**：
- `points_frozen` INTEGER DEFAULT 0
- `download_count` INTEGER DEFAULT 0
- `abandoned_at` INTEGER（时间戳）
- `job_type` TEXT（'compress' | 'convert'）

**point_refunds 表**（新增）：
```sql
CREATE TABLE point_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
```

**suspicious_users 表**（新增）：
```sql
CREATE TABLE suspicious_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  reason TEXT,
  flagged_at INTEGER NOT NULL
);
```

---

## 三、广告系统

### 广告位定义

| 广告位ID | 位置 | 类型 | 说明 |
|---------|------|------|------|
| `slot_sidebar_1` | 右侧栏顶部 | 赞助商 | 深色卡片，带标题+描述+按钮 |
| `slot_sidebar_2` | 右侧栏中部 | CPM | 深色内嵌卡片 |
| `slot_reward` | 看广告弹窗 | 激励广告 | 倒计时5秒，完播得积分 |
| `slot_bottom_1/2/3` | 底部3栏 | 联盟推广 | 标题+描述+标签 |

### 广告配置（存入 SQLite settings 表）

```json
{
  "ads": {
    "slot_sidebar_1": {
      "enabled": true,
      "title": "GPT-5.5 API 限时优惠",
      "description": "稳定高速AI接口服务",
      "link": "",
      "tag": "推荐赞助"
    },
    "slot_sidebar_2": {
      "enabled": true,
      "title": "Claude Code",
      "description": "AI编程效率提升10倍",
      "link": "",
      "tag": "CPM广告位"
    },
    "slot_reward": {
      "enabled": true,
      "title": "赞助商广告",
      "description": "",
      "link": "",
      "watch_seconds": 5,
      "reward_points": 10
    },
    "slot_bottom": [
      { "enabled": true, "title": "AI工具导航推荐", "description": "", "link": "", "tag": "联盟推广" },
      { "enabled": true, "title": "文件下载前广告", "description": "", "link": "", "tag": "下载弹窗" },
      { "enabled": true, "title": "站内互导流量", "description": "", "link": "", "tag": "工具矩阵" }
    ]
  }
}
```

广告配置通过 `GET /api/config` 随页面配置下发，管理后台可实时修改生效。

### 广告管理后台

现有 `/admin` 页面新增"广告管理"Tab：
- 每个广告位开启/下架切换
- 编辑标题、描述、链接、标签
- 保存后立即生效（无需重启）

---

## 四、广告数据埋点

### 埋点事件（写入现有 SQLite events 表）

| 事件名 | 触发时机 | 携带字段 |
|-------|---------|---------|
| `ad_view` | 广告进入视口（IntersectionObserver，去重：同广告位同session只记一次） | slot_id, ad_title |
| `ad_click` | 用户点击广告 | slot_id, ad_title, target_url |
| `ad_reward_start` | 点击"看广告得积分" | slot_id |
| `ad_reward_complete` | 倒计时结束完播 | slot_id, watch_seconds |
| `ad_reward_skip` | 弹窗关闭未完播 | slot_id, watch_seconds_watched |

**完播率** = `ad_reward_complete` ÷ `ad_reward_start`  
**点击率** = `ad_click` ÷ `ad_view`

### 后台统计接口

`GET /api/admin/ads/stats?days=7`

返回格式：
```json
{
  "slots": [
    { "slot_id": "slot_sidebar_1", "name": "赞助位", "views": 1234, "clicks": 89, "ctr": 0.072, "completion_rate": null },
    { "slot_id": "slot_reward", "name": "激励广告", "views": 234, "clicks": null, "ctr": null, "completion_rate": 0.782 }
  ],
  "period_days": 7
}
```

### 后台中文表格展示

```
广告数据统计（近7天）
┌──────────┬──────┬──────┬──────┬──────────┐
│ 广告位    │ 曝光量 │ 点击量 │ 点击率 │ 完播率   │
├──────────┼──────┼──────┼──────┼──────────┤
│ 赞助位    │ 1,234 │ 89  │ 7.2% │ --      │
│ CPM位    │  987  │ 45  │ 4.6% │ --      │
│ 激励广告  │  234  │ --  │ --   │ 78.2%  │
│ 底部联盟1 │  456  │ 12  │ 2.6% │ --      │
└──────────┴──────┴──────┴──────┴──────────┘
```

---

## 五、PDF转Word技术实现

### Dockerfile 改造

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ghostscript \
    python3 python3-pip \
    && pip3 install pdf2docx --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data
EXPOSE 3487
CMD ["node", "server-simple.js"]
```

镜像体积增加约350MB，Railway冷启动多约8秒。

### 新增文件

**`scripts/convert_pdf.py`**：
- 接收参数：`input_path output_path`
- 使用 pdf2docx 执行转换
- 转换完成输出 `{"status": "done", "pages": N}` 到 stdout
- 错误时输出 `{"status": "error", "message": "..."}` 并以非零码退出

### 新增API路由

| 路由 | 方法 | 说明 |
|-----|------|------|
| `/api/convert` | POST | 上传PDF，创建转换任务（同 /api/jobs 的鉴权+积分逻辑） |
| `/api/convert/:id` | GET | 查询任务状态 |
| `/api/convert/:id/events` | GET | SSE进度推送 |
| `/api/convert/:id/download` | GET | 下载 .docx 文件 |
| `/api/convert/:id/abandon` | POST | beacon通知任务放弃 |

### 限制与说明

- 文件大小上限：50MB（比压缩的250MB更严，pdf2docx内存占用较高）
- 超时：120秒
- 转换质量：文字段落完整保留可编辑；复杂多栏排版、数学公式、嵌入图表会有偏差，UI上提前告知用户
- 输出文件名：原文件名 + `_converted.docx`

---

## 六、文件清理机制

### 触发条件

| 条件 | 行为 |
|-----|------|
| 用户刷新/关闭页面 | `beforeunload` 发送 beacon 到 `/api/jobs/:id/abandon` 或 `/api/convert/:id/abandon` |
| 任务 abandon 且 processing | 立即终止子进程，删除临时文件，返还冻结积分 |
| 任务 abandon 且 done | 文件保留60分钟，到期后定时清除 |
| 服务端任务失败（error） | 立即删除临时文件，返还积分，前端提示刷新重试 |
| 定时清理（每15分钟） | 清除所有超过60分钟的临时文件 |

### 前端错误提示

所有任务失败状态（`status === 'error'`）统一显示：
> "处理失败，积分已返还。请刷新页面重试。"  
> [刷新页面] 按钮

---

## 七、风控兜底设计（4层）

| 层级 | 措施 | 实现 |
|-----|------|------|
| L1 | 每用户每日最多返还3次 | `point_refunds` 表按 user_id + 日期计数，超限后失败不返还，提示联系客服 |
| L2 | abandon 连续操作限速 | 同一用户60秒内 abandon ≥ 3次，禁用当日返还资格，写入 `suspicious_users` |
| L3 | 任务最短运行时间 | 任务启动后3秒内 abandon，视为无效，不扣也不返 |
| L4 | 异常用户标记 | 命中L2/L3记录到 `suspicious_users` 表，管理后台可查，支持手动处理 |

---

## 八、新增后端接口汇总

| 路由 | 方法 | 说明 |
|-----|------|------|
| `/api/convert` | POST | 创建PDF转Word任务 |
| `/api/convert/:id` | GET | 查询转换任务状态 |
| `/api/convert/:id/events` | GET | SSE进度 |
| `/api/convert/:id/download` | GET | 下载.docx |
| `/api/convert/:id/abandon` | POST | 任务放弃（beacon） |
| `/api/jobs/:id/abandon` | POST | 压缩任务放弃（新增） |
| `/api/ads/reward` | POST | 完播广告，发放积分 |
| `/api/admin/ads` | GET/POST | 获取/更新广告配置 |
| `/api/admin/ads/stats` | GET | 广告统计数据 |

---

## 九、实施顺序建议

1. Dockerfile 改造 + python convert_pdf.py
2. server-simple.js：新增 jobs 表字段 + point_refunds + suspicious_users 表迁移
3. server-simple.js：积分冻结/解冻/返还逻辑 + abandon 接口 + 风控L1-L4
4. server-simple.js：PDF转Word路由
5. server-simple.js：广告配置存储 + /api/ads/reward + 广告统计接口
6. 前端：index.html + styles.css 按新原型重写
7. 前端：app.js 扩展（工具切换、转Word流程、广告埋点、积分不足弹窗）
8. 后台：admin.html 新增广告管理Tab + 广告统计表格
