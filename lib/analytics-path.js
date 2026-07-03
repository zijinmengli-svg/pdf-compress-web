"use strict";
const path = require("path");

function chooseAnalyticsFile(env, rootDir) {
  if (env && env.ANALYTICS_FILE) return env.ANALYTICS_FILE;
  if (env && env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, "analytics-events.jsonl");
  }
  return path.join(rootDir, "data", "analytics-events.jsonl");
}

module.exports = { chooseAnalyticsFile };
