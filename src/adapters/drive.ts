import { Readable } from 'stream';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import type { DriveAdapter } from '../types.js';

export class DriveService implements DriveAdapter {
  async createFolder(name: string, parentId: string): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    const id = response.data.id;
    if (!id) throw new Error(`Drive API returned no ID when creating folder "${name}"`);
    return id;
  }

  async moveFolder(folderId: string, targetParentId: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
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
    const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
    await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(content) },
      fields: 'id',
    });
  }

  async copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
    await drive.files.copy({
      fileId: templateId,
      requestBody: { name, parents: [destFolderId] },
      fields: 'id',
    });
  }
}
