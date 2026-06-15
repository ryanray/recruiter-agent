import type { DriveAdapter } from '../types.js';

export class FakeDriveAdapter implements DriveAdapter {
  folders: { id: string; name: string; parentId: string }[] = [];
  files: { folderId: string; name: string; content: Buffer; mimeType: string }[] = [];
  copies: { templateId: string; destFolderId: string; name: string }[] = [];
  moves: { folderId: string; targetParentId: string }[] = [];
  seededSubfolders: { parentId: string; id: string; name: string }[] = [];
  private nextId = 1;

  async createFolder(name: string, parentId: string): Promise<string> {
    const id = `folder-${this.nextId++}`;
    this.folders.push({ id, name, parentId });
    return id;
  }

  async moveFolder(folderId: string, targetParentId: string): Promise<void> {
    this.moves.push({ folderId, targetParentId });
  }

  async uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void> {
    this.files.push({ folderId, name, content, mimeType });
  }

  async copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void> {
    this.copies.push({ templateId, destFolderId, name });
  }

  async listSubfolders(parentId: string): Promise<{ id: string; name: string }[]> {
    return this.seededSubfolders
      .filter(f => f.parentId === parentId)
      .map(f => ({ id: f.id, name: f.name }));
  }
}
