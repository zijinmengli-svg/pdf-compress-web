# Metabase 数据查看接入

当前项目已经把用户统计数据写入本地 SQLite：

- 数据库文件：`data/analytics.sqlite`
- 站点配置：`data/settings.json`
- 兼容快照：`data/analytics.json`

## 直接在本机查看 SQLite

如果你只是想先看数据，不一定要马上开 Metabase，可以直接在终端里看。

### 方式 1：用 npm 快捷命令

在项目根目录运行：

```bash
npm run db:tables
npm run db:summary
npm run db:funnel
npm run db:events
npm run db:refunds
```

这些命令分别对应：

- `db:tables`
  看当前有哪些表和视图。
- `db:summary`
  看访客、事件、异常任务、退款申请总数。
- `db:funnel`
  看最近 14 天的每日漏斗汇总。
- `db:events`
  看最近 20 条事件明细。
- `db:refunds`
  看最近 20 条退款记录。

### 方式 2：用查看脚本

项目里已经加了一个脚本：

```bash
./scripts/sqlite_inspect.sh summary
./scripts/sqlite_inspect.sh visitors 20
./scripts/sqlite_inspect.sh events 30
./scripts/sqlite_inspect.sh funnel 14
./scripts/sqlite_inspect.sh failures 50
./scripts/sqlite_inspect.sh refunds 20
```

如果你想自己查：

```bash
./scripts/sqlite_inspect.sh sql "SELECT * FROM visitors LIMIT 5;"
```

### 方式 3：直接进 sqlite3 交互界面

```bash
sqlite3 /Users/libin/Desktop/PDF压缩工具-最终版/data/analytics.sqlite
```

进去后常用命令：

```sql
.tables
.schema visitors
.schema events
SELECT * FROM visitors LIMIT 5;
SELECT * FROM metabase_daily_funnel ORDER BY day DESC LIMIT 14;
```

## 浏览器数据页

现在项目里还新增了一个只读数据页：

```text
/insights
```

它会直接读取 SQLite 里的聚合结果，适合你快速看：

- 数据总量
- 近 14 天访问/上传/压缩/下载趋势
- 近 30 天事件类型分布
- 最近访客
- 最近失败记录
- 最近退款记录

这个页面复用后台登录态。先登录 `/admin`，再点“查看数据页”即可。

## 推荐连接方式

在 Metabase 中新增数据库连接，选择 `SQLite`，数据库文件路径填：

```text
/Users/libin/Desktop/PDF压缩工具-最终版/data/analytics.sqlite
```

如果你把项目移动到别的目录，Metabase 里同步改成新的绝对路径。

## 关键表

- `visitors`
  存每个访客的累计行为指标，适合看用户级明细、活跃用户、免费额度、付费额度。
- `events`
  存所有事件明细，适合做趋势、漏斗、文件失败原因、来源分析。
- `exception_tasks`
  存压缩异常和服务异常，适合看失败任务。
- `refund_requests`
  存退费申请和处理状态。

## 已内置的 Metabase 视图

- `metabase_daily_event_metrics`
  按天、按事件类型聚合，适合做折线图和柱状图。
- `metabase_daily_funnel`
  按天汇总访问、上传、压缩、下载、付费触发、购买点击、退费申请，适合直接做漏斗/趋势。

## 建议先做的 6 个图表

1. 每日访问与上传趋势
   数据源：`metabase_daily_funnel`
   指标：`pv_page_visit`、`uv_page_visit`、`upload_success_count`

2. 每日压缩成功率
   数据源：`metabase_daily_funnel`
   自定义列：`compress_success_count * 1.0 / nullif(compress_start_count, 0)`

3. 每日下载转化率
   数据源：`metabase_daily_funnel`
   自定义列：`download_success_count * 1.0 / nullif(compress_success_count, 0)`

4. 事件漏斗
   数据源：`metabase_daily_funnel`
   指标：`uv_page_visit` -> `upload_success_count` -> `compress_start_count` -> `compress_success_count` -> `download_success_count`

5. 最近失败任务列表
   数据源：`exception_tasks`
   维度：`time`、`kind`、`job_id`、`file_name`、`message`

6. 待处理退款列表
   数据源：`refund_requests`
   过滤条件：`status = pending`

## 适合直接写 SQL 的查询

### 近 30 天压缩成功率

```sql
SELECT
  day,
  compress_start_count,
  compress_success_count,
  ROUND(compress_success_count * 100.0 / NULLIF(compress_start_count, 0), 2) AS success_rate_pct
FROM metabase_daily_funnel
WHERE day >= date('now', '-30 day')
ORDER BY day;
```

### 近 30 天各事件趋势

```sql
SELECT
  day,
  event_type,
  event_count,
  unique_visitors
FROM metabase_daily_event_metrics
WHERE day >= date('now', '-30 day')
ORDER BY day, event_type;
```

### 最近 100 条上传或压缩失败事件

```sql
SELECT
  datetime(time / 1000, 'unixepoch', 'localtime') AS event_time,
  visitor_id,
  type,
  file_name,
  message,
  job_id
FROM events
WHERE type IN ('upload_failure', 'compress_failure')
ORDER BY time DESC
LIMIT 100;
```

### 免费额度消耗较高的访客

```sql
SELECT
  id AS visitor_id,
  last_seen_at,
  quota_used,
  paid_credits,
  page_visits,
  upload_success,
  compress_success,
  download_success
FROM visitors
ORDER BY quota_used DESC, last_seen_at DESC
LIMIT 100;
```

## 说明

- 当前后台 `/admin` 继续负责配置和退款处理。
- Metabase 只负责“看数”和“分析”。
- SQLite 里保留全量事件历史；后台内存只加载最近一部分数据，所以后台不会因为历史数据增多而明显变慢。
