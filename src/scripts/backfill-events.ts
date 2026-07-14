// One-time backfill: parses logs/*.log and populates the Events tab.
// Refuses to run if the Events tab already has data rows.
// Usage: npm run backfill-events
import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';
import { extractEventsFromLog, dedupeEvents, type BackfillEvent } from '../backfill.js';

const config = loadConfig();
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

// Safety: only run against an empty Events tab (header row only).
let existingRows: unknown[];
try {
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Events!A2:D' });
  existingRows = existing.data.values ?? [];
} catch (err) {
  console.error(`Could not read the Events tab (${err instanceof Error ? err.message : err}).`);
  console.error('If the tab does not exist yet, run: npm run add-events-tab');
  process.exit(1);
}
if (existingRows.length > 0) {
  console.error(`Events tab already has ${existingRows.length} data row(s) — aborting to prevent a double backfill.`);
  process.exit(1);
}

const logsDir = resolve('logs');
const all: BackfillEvent[] = [];
for (const filename of readdirSync(logsDir).sort()) {
  if (!filename.endsWith('.log')) continue;
  try {
    all.push(...extractEventsFromLog(filename, readFileSync(join(logsDir, filename), 'utf8')));
  } catch (err) {
    console.warn(`Skipping unreadable log file ${filename}: ${err instanceof Error ? err.message : err}`);
  }
}

const events = dedupeEvents(all);
if (events.length === 0) {
  console.log('No events found in logs — nothing to backfill.');
  process.exit(0);
}

await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: 'Events!A:D',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: events.map(e => [e.date, e.candidate, e.event, e.detail]) },
});

const byType = new Map<string, number>();
for (const e of events) byType.set(e.event, (byType.get(e.event) ?? 0) + 1);
console.log(`✓ Backfilled ${events.length} event(s):`);
for (const [type, count] of [...byType.entries()].sort()) {
  console.log(`  ${type}: ${count}`);
}
