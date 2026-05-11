#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/launchd"
TARGET_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$ROOT_DIR/reports/logs"

DAILY_LABEL="com.libin.pdf-compress-report.daily"
WEEKLY_LABEL="com.libin.pdf-compress-report.weekly"
DAILY_PLIST="$SOURCE_DIR/$DAILY_LABEL.plist"
WEEKLY_PLIST="$SOURCE_DIR/$WEEKLY_LABEL.plist"
TARGET_DAILY="$TARGET_DIR/$DAILY_LABEL.plist"
TARGET_WEEKLY="$TARGET_DIR/$WEEKLY_LABEL.plist"
GUI_DOMAIN="gui/$(id -u)"

mkdir -p "$TARGET_DIR" "$LOG_DIR"
cp "$DAILY_PLIST" "$TARGET_DAILY"
cp "$WEEKLY_PLIST" "$TARGET_WEEKLY"

launchctl bootout "$GUI_DOMAIN/$DAILY_LABEL" >/dev/null 2>&1 || true
launchctl bootout "$GUI_DOMAIN/$WEEKLY_LABEL" >/dev/null 2>&1 || true

launchctl bootstrap "$GUI_DOMAIN" "$TARGET_DAILY"
launchctl bootstrap "$GUI_DOMAIN" "$TARGET_WEEKLY"
launchctl enable "$GUI_DOMAIN/$DAILY_LABEL"
launchctl enable "$GUI_DOMAIN/$WEEKLY_LABEL"

echo "已安装自动报表任务："
echo "- 每天 09:30 自动导出本地报表"
echo "- 每周一 09:45 再导出一份周报快照"
echo
echo "LaunchAgents:"
echo "- $TARGET_DAILY"
echo "- $TARGET_WEEKLY"
