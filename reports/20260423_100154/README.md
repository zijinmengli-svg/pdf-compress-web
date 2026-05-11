# PDF 压缩数据报表

- 生成时间：2026-04-23 10:01:55 CST
- 数据库：/Users/libin/Desktop/PDF压缩工具-最终版/data/analytics.sqlite
- 报表目录：/Users/libin/Desktop/PDF压缩工具-最终版/reports/20260423_100154
- Clarity 文件：未附带

## 总览

```text
┌──────────┬────────┬─────────────────┬─────────────────┬─────────────────┬───────────────────┐
│ visitors │ events │ exception_tasks │ refund_requests │ pending_refunds │ compress_failures │
├──────────┼────────┼─────────────────┼─────────────────┼─────────────────┼───────────────────┤
│ 14       │ 276    │ 3               │ 1               │ 0               │ 2                 │
└──────────┴────────┴─────────────────┴─────────────────┴─────────────────┴───────────────────┘
```

## 文件说明

- `01_summary.csv`
  核心汇总指标。
- `02_daily_funnel_30d.csv`
  最近 30 天访问、上传、压缩、下载漏斗。
- `03_event_types_30d.csv`
  最近 30 天事件类型统计。
- `04_recent_visitors.csv`
  最近 100 个访客指标。
- `05_recent_events.csv`
  最近 300 条埋点事件。
- `06_failures.csv`
  上传失败和压缩失败记录。
- `07_refunds.csv`
  退款申请与处理记录。
- `08_summary.json`
  便于脚本二次处理的汇总 JSON。
- `09_clarity_export.*`
  如果导出时附带了 Clarity 文件，会复制到这里。

## 建议查看顺序

1. 先看 `01_summary.csv`
2. 再看 `02_daily_funnel_30d.csv`
3. 如果有异常，再看 `06_failures.csv`
4. 想看访客明细，再看 `04_recent_visitors.csv` 和 `05_recent_events.csv`
