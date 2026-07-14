// src/scripts/add-interview-result-columns.ts
import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';

const config = loadConfig();
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;
const CANDIDATE_TABS = ['Active', 'Hired', 'Rejected', 'Never Responded', 'Checkback Later'];

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

console.log(`Fetching spreadsheet metadata for ${spreadsheetId}...`);
const meta = await sheets.spreadsheets.get({ spreadsheetId });
const sheetMap = new Map<string, number>(
  (meta.data.sheets ?? []).map(s => [s.properties!.title!, s.properties!.sheetId!])
);

for (const tab of CANDIDATE_TABS) {
  const sheetId = sheetMap.get(tab);
  if (sheetId == null) {
    console.warn(`Tab "${tab}" not found — skipping.`);
    continue;
  }
  console.log(`Processing tab "${tab}" (sheetId=${sheetId})...`);

  // Idempotency guard: check if columns already exist
  const check = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!N1`,
  });
  const n1 = (check.data.values?.[0]?.[0] as string | undefined) ?? '';
  if (n1 === 'Phone Interview Result') {
    console.warn(`Tab "${tab}" already has interview result columns — skipping (idempotency guard).`);
    continue;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Insert 2 columns at index 13 (after column M=humanDecision)
        {
          insertDimension: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 13, endIndex: 15 },
            inheritFromBefore: false,
          },
        },
        // Insert 1 column at index 26 (before createdAt, which shifted to index 26 after previous insert)
        {
          insertDimension: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 26, endIndex: 27 },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  // Write headers to row 1 for the new columns
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `'${tab}'!N1`, values: [['Phone Interview Result']] },
        { range: `'${tab}'!O1`, values: [['In-Person Interview Result']] },
        { range: `'${tab}'!AA1`, values: [['In-Person Interview Scheduled At']] },
      ],
    },
  });

  console.log(`  ✓ Inserted columns and wrote headers for "${tab}"`);
}

console.log('\nDone. Deploy code changes (Tasks 2–4) now.');
