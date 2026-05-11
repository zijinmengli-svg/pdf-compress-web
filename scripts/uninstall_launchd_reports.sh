#!/usr/bin/env bash
set -euo pipefail

DAILY_LABEL="com.libin.pdf-compress-report.daily"
WEEKLY_LABEL="com.libin.pdf-compress-report.weekly"
TARGET_DIR="$HOME/Library/LaunchAgents"
GUI_DOMAIN="gui/$(id -u)"

launchctl bootout "$GUI_DOMAIN/$DAILY_LABEL" >/dev/null 2>&1 || true
launchctl bootout "$GUI_DOMAIN/$WEEKLY_LABEL" >/dev/null 2>&1 || true

rm -f "$TARGET_DIR/$DAILY_LABEL.plist"
rm -f "$TARGET_DIR/$WEEKLY_LABEL.plist"

echo "已卸载自动报表任务。"
