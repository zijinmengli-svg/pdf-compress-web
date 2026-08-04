"use strict";

const path = require("path");
const { readAnalyticsEvents } = require("../lib/analytics");
const { createAnalyticsStore } = require("../lib/analytics-store");

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("usage: DATABASE_URL=... node scripts/import-analytics-jsonl.js /absolute/path/events.jsonl");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const events = await readAnalyticsEvents(path.resolve(source));
  const store = createAnalyticsStore({ databaseUrl: process.env.DATABASE_URL, filePath: "", explicitFilePath: false });
  try {
    const result = await store.importEvents(events);
    console.log(JSON.stringify({ sourceEvents: events.length, ...result }));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
