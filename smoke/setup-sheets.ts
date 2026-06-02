import 'dotenv/config';
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const saPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
const key = JSON.parse(readFileSync(saPath, 'utf8')) as { client_email: string; private_key: string };

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;

const TABS = [
  {
    name: 'Active',
    headers: ['name', 'phone', 'email', 'indeedUrl', 'location', 'experience', 'certifications', 'status', 'lastContact', 'driveFolder', 'notes'],
  },
  {
    name: 'Rejected',
    headers: ['name', 'phone', 'email', 'indeedUrl', 'location', 'experience', 'certifications', 'status', 'lastContact', 'driveFolder', 'notes'],
  },
  {
    name: 'Hired',
    headers: ['name', 'phone', 'email', 'indeedUrl', 'location', 'experience', 'certifications', 'status', 'lastContact', 'driveFolder', 'notes'],
  },
  {
    name: 'Checkback Later',
    headers: ['name', 'phone', 'email', 'indeedUrl', 'location', 'experience', 'certifications', 'status', 'lastContact', 'driveFolder', 'notes'],
  },
  {
    name: 'Communication Log',
    headers: ['date', 'candidate', 'direction', 'message', 'channel'],
  },
];

// Get existing sheet names
const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
const existingNames = new Set(
  (spreadsheet.data.sheets ?? []).map(s => s.properties?.title ?? '')
);
console.log('Existing tabs:', [...existingNames].join(', ') || '(none)');

// Create any missing tabs
const tabsToCreate = TABS.filter(t => !existingNames.has(t.name));
if (tabsToCreate.length > 0) {
  console.log('Creating tabs:', tabsToCreate.map(t => t.name).join(', '));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: tabsToCreate.map(t => ({
        addSheet: { properties: { title: t.name } },
      })),
    },
  });
  console.log('Tabs created.');
} else {
  console.log('All tabs already exist.');
}

// Write headers to each tab (row 1)
for (const tab of TABS) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab.name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [tab.headers] },
  });
  console.log(`Headers written to "${tab.name}".`);
}

console.log('\nDone! Your tracker is ready.');
console.log(`Open it here: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
