#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$ROOT_DIR/data/analytics.sqlite"
REPORTS_DIR="$ROOT_DIR/reports"
STAMP="$(date '+%Y%m%d_%H%M%S')"
OUTPUT_DIR="$REPORTS_DIR/$STAMP"
STATUS_DIR="$REPORTS_DIR/status"
KEEP_DAYS="${KEEP_DAYS:-30}"

CLARITY_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clarity-file)
      CLARITY_FILE="${2:-}"
      shift 2
      ;;
    *)
      echo "未知参数: $1" >&2
      echo "用法: ./scripts/export_report_bundle.sh [--clarity-file /path/to/clarity-export.csv]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite 数据库不存在: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$STATUS_DIR"

sqlite_csv() {
  local file="$1"
  local sql="$2"
  sqlite3 -cmd ".timeout 3000" -header -csv "$DB_PATH" "$sql" > "$file"
}

sqlite_box() {
  local sql="$1"
  sqlite3 -cmd ".timeout 3000" -box "$DB_PATH" "$sql"
}

sqlite_json() {
  local file="$1"
  local sql="$2"
  sqlite3 -cmd ".timeout 3000" -json "$DB_PATH" "$sql" > "$file"
}

sqlite_csv "$OUTPUT_DIR/01_summary.csv" "
SELECT
  (SELECT COUNT(*) FROM visitors) AS visitors,
  (SELECT COUNT(*) FROM events) AS events,
  (SELECT COUNT(*) FROM exception_tasks) AS exception_tasks,
  (SELECT COUNT(*) FROM refund_requests) AS refund_requests,
  (SELECT COUNT(*) FROM refund_requests WHERE status = 'pending') AS pending_refunds,
  (SELECT COUNT(*) FROM events WHERE type = 'compress_failure') AS compress_failures;
"

sqlite_csv "$OUTPUT_DIR/02_daily_funnel_30d.csv" "
SELECT
  day,
  uv_page_visit,
  pv_page_visit,
  upload_success_count,
  compress_start_count,
  compress_success_count,
  compress_failure_count,
  download_success_count,
  payment_required_count,
  purchase_click_count,
  refund_request_count
FROM metabase_daily_funnel
ORDER BY day DESC
LIMIT 30;
"

sqlite_csv "$OUTPUT_DIR/03_event_types_30d.csv" "
SELECT
  type AS event_type,
  COUNT(*) AS event_count,
  COUNT(DISTINCT visitor_id) AS unique_visitors
FROM events
WHERE time >= (strftime('%s', 'now', '-30 day') * 1000)
GROUP BY type
ORDER BY event_count DESC, event_type ASC;
"

sqlite_csv "$OUTPUT_DIR/04_recent_visitors.csv" "
SELECT
  id AS visitor_id,
  datetime(first_seen_at / 1000, 'unixepoch', 'localtime') AS first_seen_at,
  datetime(last_seen_at / 1000, 'unixepoch', 'localtime') AS last_seen_at,
  page_visits,
  upload_success,
  compress_success,
  compress_failure,
  download_success,
  quota_used,
  paid_credits
FROM visitors
ORDER BY last_seen_at DESC
LIMIT 100;
"

sqlite_csv "$OUTPUT_DIR/05_recent_events.csv" "
SELECT
  datetime(time / 1000, 'unixepoch', 'localtime') AS event_time,
  type,
  visitor_id,
  file_name,
  file_bytes,
  target_mb,
  message,
  job_id
FROM events
ORDER BY time DESC
LIMIT 300;
"

sqlite_csv "$OUTPUT_DIR/06_failures.csv" "
SELECT
  datetime(time / 1000, 'unixepoch', 'localtime') AS event_time,
  type,
  visitor_id,
  file_name,
  message,
  job_id
FROM events
WHERE type IN ('upload_failure', 'compress_failure')
ORDER BY time DESC
LIMIT 200;
"

sqlite_csv "$OUTPUT_DIR/07_refunds.csv" "
SELECT
  datetime(created_at / 1000, 'unixepoch', 'localtime') AS created_at,
  status,
  contact_email,
  payment_account,
  payment_name,
  package_name,
  amount_cny,
  admin_note
FROM refund_requests
ORDER BY created_at DESC
LIMIT 200;
"

sqlite_json "$OUTPUT_DIR/08_summary.json" "
SELECT
  (SELECT COUNT(*) FROM visitors) AS visitors,
  (SELECT COUNT(*) FROM events) AS events,
  (SELECT COUNT(*) FROM exception_tasks) AS exception_tasks,
  (SELECT COUNT(*) FROM refund_requests) AS refund_requests,
  (SELECT COUNT(*) FROM refund_requests WHERE status = 'pending') AS pending_refunds,
  (SELECT COUNT(*) FROM events WHERE type = 'compress_failure') AS compress_failures,
  datetime((SELECT MAX(time) FROM events) / 1000, 'unixepoch', 'localtime') AS latest_event_time,
  datetime((SELECT MAX(last_seen_at) FROM visitors) / 1000, 'unixepoch', 'localtime') AS latest_visitor_time;
"

if [[ -n "$CLARITY_FILE" ]]; then
  if [[ ! -f "$CLARITY_FILE" ]]; then
    echo "Clarity 文件不存在: $CLARITY_FILE" >&2
    exit 1
  fi
  cp "$CLARITY_FILE" "$OUTPUT_DIR/09_clarity_export$(basename "$CLARITY_FILE" | sed -E 's/.*(\.[A-Za-z0-9]+)$/\1/')"
fi

SUMMARY_BOX="$(sqlite_box "
SELECT
  (SELECT COUNT(*) FROM visitors) AS visitors,
  (SELECT COUNT(*) FROM events) AS events,
  (SELECT COUNT(*) FROM exception_tasks) AS exception_tasks,
  (SELECT COUNT(*) FROM refund_requests) AS refund_requests,
  (SELECT COUNT(*) FROM refund_requests WHERE status = 'pending') AS pending_refunds,
  (SELECT COUNT(*) FROM events WHERE type = 'compress_failure') AS compress_failures;
")"

cat > "$OUTPUT_DIR/README.md" <<EOF
# PDF 压缩数据报表

- 生成时间：$(date '+%Y-%m-%d %H:%M:%S %Z')
- 数据库：$DB_PATH
- 报表目录：$OUTPUT_DIR
- Clarity 文件：${CLARITY_FILE:-未附带}

## 总览

\`\`\`text
$SUMMARY_BOX
\`\`\`

## 文件说明

- \`01_summary.csv\`
  核心汇总指标。
- \`02_daily_funnel_30d.csv\`
  最近 30 天访问、上传、压缩、下载漏斗。
- \`03_event_types_30d.csv\`
  最近 30 天事件类型统计。
- \`04_recent_visitors.csv\`
  最近 100 个访客指标。
- \`05_recent_events.csv\`
  最近 300 条埋点事件。
- \`06_failures.csv\`
  上传失败和压缩失败记录。
- \`07_refunds.csv\`
  退款申请与处理记录。
- \`08_summary.json\`
  便于脚本二次处理的汇总 JSON。
- \`09_clarity_export.*\`
  如果导出时附带了 Clarity 文件，会复制到这里。

## 建议查看顺序

1. 先看 \`01_summary.csv\`
2. 再看 \`02_daily_funnel_30d.csv\`
3. 如果有异常，再看 \`06_failures.csv\`
4. 想看访客明细，再看 \`04_recent_visitors.csv\` 和 \`05_recent_events.csv\`
EOF

find "$REPORTS_DIR" -mindepth 1 -maxdepth 1 -type d \
  ! -name logs \
  ! -name status \
  -mtime +"$KEEP_DAYS" \
  -exec rm -rf {} +

echo "报表已生成: $OUTPUT_DIR"
