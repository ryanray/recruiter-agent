import { describe, it, expect, beforeEach } from 'vitest';
import { seedPreviouslyContacted } from '../src/scripts/seed-previously-contacted.js';
import { FakeDriveAdapter } from '../src/fakes/drive.fake.js';
import { FakeSheetsAdapter } from '../src/fakes/sheets.fake.js';

describe('seedPreviouslyContacted', () => {
  let drive: FakeDriveAdapter;
  let sheets: FakeSheetsAdapter;
  const FOLDER_ID = 'root-folder-id';

  beforeEach(() => {
    drive = new FakeDriveAdapter();
    sheets = new FakeSheetsAdapter();
  });

  it('adds new entries from Drive subfolders', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'f1', name: 'Smith, Jane - 2025-03-14' },
      { parentId: FOLDER_ID, id: 'f2', name: 'Brown, Alice - 2025-06-01' },
    );

    const result = await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    expect(sheets.previouslyContacted).toHaveLength(2);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('skips entries already in the tab (idempotent)', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'f1', name: 'Smith, Jane - 2025-03-14' },
      { parentId: FOLDER_ID, id: 'f2', name: 'Brown, Alice - 2025-06-01' },
    );
    sheets.previouslyContacted.push({
      name: 'Smith, Jane - 2025-03-14', lastContact: '2025-03-14', notes: 'Seeded from Drive', indeedId: '',
    });

    const result = await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    expect(sheets.previouslyContacted).toHaveLength(2);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('parses date from folder name ending with YYYY-MM-DD', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'f1', name: 'Johnson, Bob - 2024-11-22' },
    );

    await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    expect(sheets.previouslyContacted[0].lastContact).toBe('2024-11-22');
    expect(sheets.previouslyContacted[0].name).toBe('Johnson, Bob - 2024-11-22');
  });

  it('falls back to today when folder name has no parseable date', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'f1', name: 'Williams, Carol' },
    );

    await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    const today = new Date().toISOString().slice(0, 10);
    expect(sheets.previouslyContacted[0].lastContact).toBe(today);
  });

  it('traverses category folders (prefixed with _) one level deep and adds their children', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'cat1', name: '_Checkback Later' },
      { parentId: 'cat1', id: 'f1', name: 'Smith, Jane - 2025-03-14' },
      { parentId: 'cat1', id: 'f2', name: 'Brown, Alice - 2025-06-01' },
    );

    const result = await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    const names = sheets.previouslyContacted.map(e => e.name);
    expect(names).toContain('Smith, Jane - 2025-03-14');
    expect(names).toContain('Brown, Alice - 2025-06-01');
    expect(names).not.toContain('_Checkback Later');
  });

  it('skips nested category folders (__ inside _) with a warning', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'cat1', name: '_Active' },
      { parentId: 'cat1', id: 'f1', name: 'Johnson, Bob - 2024-11-22' },
      { parentId: 'cat1', id: 'sub1', name: '_SubCategory' },
    );

    const result = await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    expect(result.added).toBe(1);
    const names = sheets.previouslyContacted.map(e => e.name);
    expect(names).toContain('Johnson, Bob - 2024-11-22');
    expect(names).not.toContain('_SubCategory');
  });

  it('handles mixed top-level folders: direct candidates and category folders', async () => {
    drive.seededSubfolders.push(
      { parentId: FOLDER_ID, id: 'f1', name: 'Williams, Carol' },
      { parentId: FOLDER_ID, id: 'cat2', name: '_Rejected' },
      { parentId: 'cat2', id: 'f2', name: 'Davis, Tom - 2025-01-15' },
    );

    const result = await seedPreviouslyContacted(drive, sheets, FOLDER_ID);

    expect(result.added).toBe(2);
    const names = sheets.previouslyContacted.map(e => e.name);
    expect(names).toContain('Williams, Carol');
    expect(names).toContain('Davis, Tom - 2025-01-15');
    expect(names).not.toContain('_Rejected');
  });
});
