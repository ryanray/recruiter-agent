import { DriveService } from '../src/adapters/drive.js';
import { loadConfig } from '../src/config.js';
import 'dotenv/config';

const config = loadConfig();
const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
const drive = new DriveService(serviceAccountPath);

console.log('Creating test folder in Caregiver Applicants...');
const folderId = await drive.createFolder(
  'SMOKE_TEST_DELETE_ME',
  config.google_drive.recruiting_root_folder_id
);
console.log(`Created folder: https://drive.google.com/drive/folders/${folderId}`);

console.log('Uploading test file...');
await drive.uploadFile(folderId, 'test.txt', Buffer.from('smoke test'), 'text/plain');
console.log('Done. Delete the SMOKE_TEST_DELETE_ME folder from Drive.');
