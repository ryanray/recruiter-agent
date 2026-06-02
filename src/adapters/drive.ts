import { readFileSync } from 'fs';
import { google } from 'googleapis';
import type { DriveAdapter } from '../types.js';

export class DriveService implements DriveAdapter {
  private auth: InstanceType<typeof google.auth.JWT>;

  constructor(serviceAccountPath: string) {
    let key: { client_email: string; private_key: string };
    try {
      key = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as { client_email: string; private_key: string };
    } catch {
      throw new Error(`Failed to load service account from ${serviceAccountPath}. Does the file exist and is it valid JSON?`);
    }
    this.auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }

  async createFolder(name: string, parentId: string): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    return response.data.id!;
  }

  async moveFolder(folderId: string, targetParentId: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const file = await drive.files.get({ fileId: folderId, fields: 'parents' });
    const previousParents = (file.data.parents ?? []).join(',');
    await drive.files.update({
      fileId: folderId,
      addParents: targetParentId,
      removeParents: previousParents,
      fields: 'id, parents',
    });
  }

  async uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const { Readable } = await import('stream');
    await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(content) },
      fields: 'id',
    });
  }

  async copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    await drive.files.copy({
      fileId: templateId,
      requestBody: { name, parents: [destFolderId] },
      fields: 'id',
    });
  }
}
