import 'dotenv/config';
import { DriveService } from '../src/adapters/drive.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const drive = new DriveService();

console.log('Creating test folder in Caregiver Applicants...');
const folderId = await drive.createFolder(
  'SMOKE_TEST_DELETE_ME',
  config.google_drive.recruiting_root_folder_id
);
console.log(`Created folder: https://drive.google.com/drive/folders/${folderId}`);

console.log('Uploading test file...');
await drive.uploadFile(folderId, 'test.txt', Buffer.from('smoke test'), 'text/plain');
console.log('Done. Delete the SMOKE_TEST_DELETE_ME folder from Drive.');
