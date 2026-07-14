// One-time setup: creates the append-only Events tab used by the weekly report.
// Usage: npm run add-events-tab
import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';

const config = loadConfig();
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

console.log(`Fetching spreadsheet metadata for ${spreadsheetId}...`);
const meta = await sheets.spreadsheets.get({ spreadsheetId });
const exists = (meta.data.sheets ?? []).some(s => s.properties?.title === 'Events');
if (exists) {
  console.warn('Events tab already exists — nothing to do (idempotency guard).');
  process.exit(0);
}

await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests: [{ addSheet: { properties: { title: 'Events' } } }] },
});

await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: 'Events!A1:D1',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [['Date', 'Candidate', 'Event', 'Detail']] },
});

console.log('✓ Created Events tab with header row.');
