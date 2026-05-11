#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$ROOT_DIR/data/analytics.sqlite"

if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite 数据库不存在: $DB_PATH" >&2
  exit 1
fi

mode="${1:-help}"

run_sql() {
  sqlite3 -cmd ".timeout 3000" -box "$DB_PATH" "$1"
}

case "$mode" in
  tables)
    sqlite3 "$DB_PATH" ".tables"
    ;;
  summary)
    run_sql "select (select count(*) from visitors) as visitors, (select count(*) from events) as events, (select count(*) from exception_tasks) as exception_tasks, (select count(*) from refund_requests) as refund_requests;"
    ;;
  visitors)
    limit="${2:-20}"
    run_sql "select id as visitor_id, datetime(last_seen_at / 1000, 'unixepoch', 'localtime') as last_seen_at, page_visits, upload_success, compress_success, download_success, quota_used, paid_credits from visitors order by last_seen_at desc limit $limit;"
    ;;
  events)
    limit="${2:-20}"
    run_sql "select datetime(time / 1000, 'unixepoch', 'localtime') as event_time, type, visitor_id, file_name, message, job_id from events order by time desc limit $limit;"
    ;;
  funnel)
    days="${2:-14}"
    run_sql "select * from metabase_daily_funnel order by day desc limit $days;"
    ;;
  failures)
    limit="${2:-50}"
    run_sql "select datetime(time / 1000, 'unixepoch', 'localtime') as event_time, type, visitor_id, file_name, message, job_id from events where type in ('upload_failure', 'compress_failure') order by time desc limit $limit;"
    ;;
  refunds)
    limit="${2:-20}"
    run_sql "select datetime(created_at / 1000, 'unixepoch', 'localtime') as created_at, status, contact_email, payment_account, package_name, amount_cny, admin_note from refund_requests order by created_at desc limit $limit;"
    ;;
  sql)
    shift
    if [[ $# -eq 0 ]]; then
      echo "请在 sql 模式后面传入 SQL 语句" >&2
      exit 1
    fi
    run_sql "$*"
    ;;
  help|*)
    cat <<'EOF'
用法:
  ./scripts/sqlite_inspect.sh tables
  ./scripts/sqlite_inspect.sh summary
  ./scripts/sqlite_inspect.sh visitors [limit]
  ./scripts/sqlite_inspect.sh events [limit]
  ./scripts/sqlite_inspect.sh funnel [days]
  ./scripts/sqlite_inspect.sh failures [limit]
  ./scripts/sqlite_inspect.sh refunds [limit]
  ./scripts/sqlite_inspect.sh sql "SELECT * FROM visitors LIMIT 5;"
EOF
    ;;
esac
