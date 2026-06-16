import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';

const SCORE_HEADERS = [
  'Score',
  'Score Recommendation',
  'Score Tier',
  'Key Strengths',
  'Concerns',
  'Interview Questions',
];

const TABS = ['Active', 'Rejected', 'Checkback Later'];

// Score columns start at O (index 14, 0-based)
const SCORE_COL_START = 14;

const config = loadConfig();
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;

for (const tab of TABS) {
  console.log(`[AddScoreColumns] Checking "${tab}" tab...`);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:T1`,
  });

  const row = (response.data.values?.[0] ?? []) as string[];
  const existingCount = row.length;

  const headersToAdd = SCORE_HEADERS.slice(Math.max(0, existingCount - SCORE_COL_START));

  if (headersToAdd.length === 0) {
    console.log(`[AddScoreColumns] "${tab}" already has score headers — skipping.`);
    continue;
  }

  const startCol = String.fromCharCode(65 + existingCount); // A=65
  const endCol = String.fromCharCode(65 + SCORE_COL_START + SCORE_HEADERS.length - 1);
  const range = `${tab}!${startCol}1:${endCol}1`;

  console.log(`[AddScoreColumns] Writing ${headersToAdd.length} header(s) to ${range}...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headersToAdd] },
  });

  console.log(`[AddScoreColumns] "${tab}" updated.`);
}

console.log('\n[AddScoreColumns] Done.');
