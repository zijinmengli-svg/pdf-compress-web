# 本地报表工作流

你现在不需要依赖后台页面，也不用先更新 GitHub。

## 目标

每次要看数据时，直接从本地生成一份报表包，统一放到：

```text
reports/YYYYMMDD_HHMMSS/
```

这样每次都有一个独立快照，方便你定期回看。

默认会自动清理超过 `30` 天的旧报表目录。

## 一键导出

在项目根目录运行：

```bash
npm run report:export
```

或者：

```bash
./scripts/export_report_bundle.sh
```

生成后会得到这些文件：

- `01_summary.csv`
- `02_daily_funnel_30d.csv`
- `03_event_types_30d.csv`
- `04_recent_visitors.csv`
- `05_recent_events.csv`
- `06_failures.csv`
- `07_refunds.csv`
- `08_summary.json`
- `README.md`

## 如果这次要合并 Clarity 导出

先从 Clarity 下载一份导出文件，然后运行：

```bash
./scripts/export_report_bundle.sh --clarity-file "/你的/Clarity导出文件.csv"
```

这个文件会被复制到同一份报表目录里，方便我后面按同一个目录一起看。

## 适合你的实际使用方式

如果你后面只是想让我“定期拉一次报表”，可以直接对我说：

```text
帮我导一份今天的本地报表
```

或者：

```text
帮我把这次 Clarity 导出和本地埋点一起整理成报表
```

我就直接在本地跑，不需要你进后台。

## 限制说明

- 我不能在你不发消息的情况下主动定时执行。
- 如果你想完全自动化到每天/每周固定生成，可以后面再加 `crontab` 或 `launchd`。
- Clarity 部分如果要我直接在线抓取，后面需要你给我可用登录态或稳定导出方式；当前最稳的是“你导出一次，我本地合并一次”。

## 本地自动生成

我已经把 `launchd` 版本准备好了，默认时间是：

- 每天 `09:30`
- 每周一 `09:45`

安装命令：

```bash
npm run report:install-schedule
```

卸载命令：

```bash
npm run report:uninstall-schedule
```

安装后生成的任务文件在：

- `~/Library/LaunchAgents/com.libin.pdf-compress-report.daily.plist`
- `~/Library/LaunchAgents/com.libin.pdf-compress-report.weekly.plist`

日志目录在：

```text
reports/logs/
```

状态文件在：

```text
reports/status/latest.json
reports/status/daily.json
reports/status/weekly.json
```

你可以直接查看最近一次任务状态：

```bash
npm run report:status
```

状态里会包含：

- 最近一次运行是否成功
- 开始时间和结束时间
- 最近一次生成的报表目录
- 对应日志文件位置
