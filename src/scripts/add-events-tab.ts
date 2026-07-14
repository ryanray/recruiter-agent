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

const addReply = await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests: [{ addSheet: { properties: { title: 'Events' } } }] },
});

const sheetId = addReply.data.replies?.[0]?.addSheet?.properties?.sheetId;
if (sheetId == null) throw new Error('addSheet reply did not include a sheetId');

// Format column A as plain text so Sheets never coerces YYYY-MM-DD date strings.
await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [{
      repeatCell: {
        range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }],
  },
});

await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: 'Events!A1:D1',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [['Date', 'Candidate', 'Event', 'Detail']] },
});

console.log('✓ Created Events tab with header row (column A formatted as plain text).');
