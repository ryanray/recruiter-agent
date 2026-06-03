import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../src/google-auth.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;

const CANDIDATE_HEADERS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
];

const TABS = [
  { name: 'Active',           headers: CANDIDATE_HEADERS },
  { name: 'Rejected',         headers: CANDIDATE_HEADERS },
  { name: 'Hired',            headers: CANDIDATE_HEADERS },
  { name: 'Checkback Later',  headers: CANDIDATE_HEADERS },
  { name: 'Communication Log', headers: ['date','candidate','direction','message','channel'] },
];

const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
const existingNames = new Set(
  (spreadsheet.data.sheets ?? []).map(s => s.properties?.title ?? '')
);
console.log('Existing tabs:', [...existingNames].join(', ') || '(none)');

const tabsToCreate = TABS.filter(t => !existingNames.has(t.name));
if (tabsToCreate.length > 0) {
  console.log('Creating tabs:', tabsToCreate.map(t => t.name).join(', '));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: tabsToCreate.map(t => ({ addSheet: { properties: { title: t.name } } })),
    },
  });
}

for (const tab of TABS) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab.name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [tab.headers] },
  });
  console.log(`Headers written to "${tab.name}".`);
}

console.log('\nDone!');
console.log(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
