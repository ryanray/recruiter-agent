import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';

// Step 1: check service account file
const saPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
console.log('1. Service account path:', saPath);
if (!existsSync(saPath)) {
  console.error('   FAIL: file does not exist');
  process.exit(1);
}
console.log('   OK: file exists');

// Step 2: parse the JSON
let key: Record<string, string>;
try {
  key = JSON.parse(readFileSync(saPath, 'utf8')) as Record<string, string>;
  console.log('2. JSON parsed OK');
  console.log('   client_email:', key['client_email'] ?? 'MISSING');
  console.log('   private_key present:', !!key['private_key']);
} catch (e) {
  console.error('2. FAIL: JSON parse error:', (e as Error).message);
  process.exit(1);
}

// Step 3: build JWT auth
import { google } from 'googleapis';
let auth: ReturnType<typeof google.auth.JWT>;
try {
  auth = new google.auth.JWT({
    email: key['client_email'],
    key: key['private_key'],
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  console.log('3. JWT auth created OK');
} catch (e) {
  console.error('3. FAIL: JWT creation error:', (e as Error).message);
  process.exit(1);
}

// Step 4: read spreadsheet ID from config
import { loadConfig } from '../src/config.js';
let spreadsheetId: string;
try {
  const config = loadConfig();
  spreadsheetId = config.google_sheets.tracker_spreadsheet_id;
  console.log('4. Config loaded OK, spreadsheet ID:', spreadsheetId);
} catch (e) {
  console.error('4. FAIL: config error:', (e as Error).message);
  process.exit(1);
}

// Step 5: make a real API call
console.log('5. Calling Sheets API...');
try {
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  console.log('   OK: spreadsheet title =', response.data.properties?.title);
} catch (e) {
  const err = e as Record<string, unknown>;
  const res = err['response'] as Record<string, unknown> | undefined;
  console.error('5. FAIL: API call failed');
  console.error('   HTTP status:', res?.['status']);
  console.error('   Error:', JSON.stringify(res?.['data'], null, 2) ?? err['message']);
  process.exit(1);
}

console.log('\nAll checks passed!');
