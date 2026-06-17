import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';

// Full expected header row A–W (must stay in sync with COLUMNS in sheets.ts)
const EXPECTED_HEADERS = [
  'Name', 'Phone', 'Email', 'Indeed URL', 'Indeed ID', 'Location',
  'Experience', 'Certifications', 'Agent Recommendation', 'Status',
  'Last Contact', 'Drive Folder', 'Human Decision', 'Notes',
  'Score', 'Score Recommendation', 'Score Tier', 'Key Strengths', 'Concerns', 'Interview Questions',
  'Processed At', 'Invite Sent At', 'Interview Scheduled At',
];

const TABS = ['Active', 'Rejected', 'Checkback Later'];

const config = loadConfig();
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;

for (const tab of TABS) {
  console.log(`[SyncHeaders] Checking "${tab}" tab...`);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:W1`,
  });

  const existing = (response.data.values?.[0] ?? []) as string[];
  const missing = EXPECTED_HEADERS.slice(existing.length);

  if (missing.length === 0) {
    console.log(`[SyncHeaders] "${tab}" already has all ${EXPECTED_HEADERS.length} headers — skipping.`);
    continue;
  }

  const startCol = String.fromCharCode(65 + existing.length);
  const endCol = String.fromCharCode(65 + EXPECTED_HEADERS.length - 1);
  const range = `${tab}!${startCol}1:${endCol}1`;

  console.log(`[SyncHeaders] Adding ${missing.length} header(s) to ${range}: ${missing.join(', ')}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [missing] },
  });

  console.log(`[SyncHeaders] "${tab}" updated.`);
}

console.log('\n[SyncHeaders] Done.');
