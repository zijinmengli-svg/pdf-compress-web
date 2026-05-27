# TinyPDF v1.0.1 发布说明

**发布日期：** 2026-05-27  
**分支：** points-system  
**对应 Git Tag：** v1.1.0

---

## 本次更新内容

### 品牌名更新
- 网站名称全局替换为 **TinyPDF**
- 涉及：标签页标题、header、meta description、OG tags、邮件模板

### 积分不足弹窗
- 积分耗尽后点击压缩，弹出"积分不足"卡片
- 左按钮：**知道了**（关闭卡片）
- 右按钮：**获取更多积分**（触发激励广告流程）

### 激励广告系统（测试模式）
- 点击"获取更多积分"弹出广告模态框
- 5 秒倒计时 mock，完成后可点击"领取积分"
- 成功后自动重新触发压缩
- 预留 Google AdSense Rewarded Ads / Monetag / Adsterra 接口

### 后端新增
- `ad_rewards` 数据表（积分领取记录）
- `POST /api/ads/reward` 接口
  - 服务端校验 watch_seconds ≥ 10
  - 每用户每日最多领取 10 次（100 积分）
  - IMMEDIATE 事务防竞态

---

## 部署方式

将本文件夹内的文件覆盖到服务器对应位置：

```
releases/v1.0.1/
├── server-simple.js          → 覆盖项目根目录
├── public/
│   ├── index.html            → 覆盖 public/
│   ├── app-simple.js         → 覆盖 public/
│   ├── admin.html            → 覆盖 public/
│   ├── styles.css            → 覆盖 public/
│   ├── faq.html              → 覆盖 public/
│   ├── terms.html            → 覆盖 public/
│   ├── privacy.html          → 覆盖 public/
│   ├── robots.txt            → 覆盖 public/
│   └── index-simple.html     → 覆盖 public/
└── RELEASE.md                （本文件，无需上传）
```

**数据库无 Schema 变更需要手动执行**：`ad_rewards` 表会在服务启动时自动创建（`initDb` 中的 `CREATE TABLE IF NOT EXISTS`），无需额外操作。

---

## 回滚方式

如需回滚到上一版本，使用 Git：
```bash
git checkout <上一版本的 commit hash>
# 或
git checkout v1.0.0   # 如存在该 tag
```

或将上一版本 `releases/` 对应文件夹中的文件覆盖回服务器。
