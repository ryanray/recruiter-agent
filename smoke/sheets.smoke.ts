import { SheetsService } from '../src/adapters/sheets.js';
import { loadConfig } from '../src/config.js';
import 'dotenv/config';

const config = loadConfig();
const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
const sheets = new SheetsService(serviceAccountPath, config.google_sheets.tracker_spreadsheet_id);

console.log('Reading active candidates...');
const candidates = await sheets.getActiveCandidates();
console.log(`Found ${candidates.length} active candidate(s).`);

console.log('Adding test row to Active tab...');
await sheets.addCandidate('Active', {
  name: 'SMOKE TEST — DELETE ME',
  phone: '000-000-0000', email: 'test@test.com',
  indeedUrl: 'https://example.com', location: 'Test City, UT',
  experience: 'none', certifications: 'none',
  status: 'UNSURE', lastContact: new Date().toISOString().slice(0, 10),
  notes: 'Smoke test row — safe to delete',
});
console.log('Done. Check your Active tab and delete the test row.');
