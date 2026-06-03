import 'dotenv/config';
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const saPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
const key = JSON.parse(readFileSync(saPath, 'utf8')) as { client_email: string; private_key: string };

console.log('Service account:', key.client_email);

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

console.log('\nListing all files/folders this service account can see...\n');

const response = await drive.files.list({
  fields: 'files(id, name, mimeType, parents)',
  pageSize: 50,
});

const files = response.data.files ?? [];
if (files.length === 0) {
  console.log('No files found — the service account cannot see anything in Drive.');
  console.log('Make sure you shared the folder with:', key.client_email);
} else {
  for (const f of files) {
    const type = f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'file';
    console.log(`[${type}] ${f.name}`);
    console.log(`        id: ${f.id}`);
  }
}

console.log(`\nFolder ID in config.yaml: ${config.google_drive.recruiting_root_folder_id}`);
const match = files.find(f => f.id === config.google_drive.recruiting_root_folder_id);
console.log(match ? '✓ Config folder ID matches an accessible folder.' : '✗ Config folder ID does NOT match any accessible folder.');
