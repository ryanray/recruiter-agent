import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../src/google-auth.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });

// Step 1: which account is this token for?
const about = await drive.about.get({ fields: 'user' });
console.log('Authenticated as:', about.data.user?.emailAddress);
console.log('Display name:', about.data.user?.displayName);
console.log();

// Step 2: try fetching the folder directly by ID
console.log('Trying to fetch folder by ID:', config.google_drive.recruiting_root_folder_id);
try {
  const file = await drive.files.get({
    fileId: config.google_drive.recruiting_root_folder_id,
    fields: 'id, name, mimeType, owners',
  });
  console.log('✓ Found:', file.data.name, '(' + file.data.mimeType + ')');
  console.log('  Owned by:', file.data.owners?.map(o => o.emailAddress).join(', '));
} catch (e) {
  const err = e as Record<string, unknown>;
  const res = err['response'] as Record<string, unknown> | undefined;
  console.log('✗ Not found via API. HTTP status:', res?.['status']);
}
console.log();

// Step 3: list everything visible to this account
console.log('All files/folders this account can see:');
const response = await drive.files.list({
  fields: 'files(id, name, mimeType)',
  pageSize: 20,
  includeItemsFromAllDrives: true,
  supportsAllDrives: true,
});
const files = response.data.files ?? [];
if (files.length === 0) {
  console.log('  (none)');
} else {
  for (const f of files) {
    const type = f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'file  ';
    console.log(`  [${type}] ${f.name}  —  ${f.id}`);
  }
}
