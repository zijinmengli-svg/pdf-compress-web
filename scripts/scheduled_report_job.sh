#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORTS_DIR="$ROOT_DIR/reports"
LOG_DIR="$REPORTS_DIR/logs"
STATUS_DIR="$REPORTS_DIR/status"
mkdir -p "$LOG_DIR" "$STATUS_DIR"

MODE="${1:-daily}"
KEEP_DAYS="${KEEP_DAYS:-30}"
LOG_FILE="$LOG_DIR/${MODE}.log"
STATUS_FILE="$STATUS_DIR/${MODE}.json"
LATEST_FILE="$STATUS_DIR/latest.json"
STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S %Z')"

write_status() {
  local status="$1"
  local output_dir="$2"
  local message="$3"
  local finished_at
  finished_at="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  cat > "$STATUS_FILE" <<EOF
{
  "mode": "$MODE",
  "status": "$status",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$finished_at",
  "keepDays": $KEEP_DAYS,
  "outputDir": "$(printf '%s' "$output_dir" | sed 's/"/\\"/g')",
  "logFile": "$(printf '%s' "$LOG_FILE" | sed 's/"/\\"/g')",
  "message": "$(printf '%s' "$message" | sed 's/"/\\"/g')"
}
EOF
  cp "$STATUS_FILE" "$LATEST_FILE"
}

{
  echo "[$STARTED_AT] start mode=$MODE keep_days=$KEEP_DAYS"
  OUTPUT="$("$ROOT_DIR/scripts/export_report_bundle.sh")"
  echo "$OUTPUT"
  OUTPUT_DIR="$(printf '%s\n' "$OUTPUT" | sed -n 's/^报表已生成: //p' | tail -n 1)"
  if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR=""
  fi
  write_status "ok" "$OUTPUT_DIR" "report generated successfully"
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] done mode=$MODE output=$OUTPUT_DIR"
} >> "$LOG_FILE" 2>&1 || {
  EXIT_CODE=$?
  write_status "error" "" "scheduled report failed with exit code $EXIT_CODE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] failed mode=$MODE exit_code=$EXIT_CODE" >> "$LOG_FILE" 2>&1
  exit "$EXIT_CODE"
}
