import type { DriveAdapter, SheetsAdapter } from '../types.js';

export async function seedPreviouslyContacted(
  drive: DriveAdapter,
  sheets: SheetsAdapter,
  folderId: string,
): Promise<{ added: number; skipped: number }> {
  console.log('[Seed] Reading existing Previously Contacted entries...');
  const existing = await sheets.getPreviouslyContactedNames();
  const existingNames = new Set(existing.map(e => e.name.toLowerCase()));
  console.log(`[Seed] ${existingNames.size} existing entries found — will skip duplicates.`);

  console.log(`[Seed] Listing subfolders of ${folderId}...`);
  const subfolders = await drive.listSubfolders(folderId);
  console.log(`[Seed] ${subfolders.length} subfolder(s) found.`);

  let added = 0;
  let skipped = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const folder of subfolders) {
    const name = folder.name.trim();
    if (existingNames.has(name.toLowerCase())) {
      console.log(`[Seed] Skipping "${name}" — already in tab.`);
      skipped++;
      continue;
    }
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})$/);
    let lastContact: string;
    if (dateMatch) {
      lastContact = dateMatch[1];
      console.log(`[Seed] Parsed date ${lastContact} from "${name}".`);
    } else {
      lastContact = todayStr;
      console.log(`[Seed] Could not parse date from "${name}" — using today's date (${todayStr}).`);
    }
    console.log(`[Seed] Adding "${name}" (lastContact: ${lastContact}).`);
    await sheets.addToPreviouslyContacted({ name, lastContact, notes: 'Seeded from Drive', indeedId: '' });
    existingNames.add(name.toLowerCase());
    added++;
  }

  console.log(`[Seed] Done. ${added} new entry/entries added, ${skipped} skipped.`);
  return { added, skipped };
}

// Entry point (only runs when executed directly, not when imported by tests)
if (process.argv[1]?.endsWith('seed-previously-contacted.ts') || process.argv[1]?.endsWith('seed-previously-contacted.js')) {
  const folderId = process.argv[2];
  if (!folderId) {
    console.error('[Seed] Usage: npm run seed-previously-contacted -- <caregiver-applicants-folder-id>');
    process.exit(1);
  }
  const { loadConfig } = await import('../config.js');
  const { DriveService } = await import('../adapters/drive.js');
  const { SheetsService } = await import('../adapters/sheets.js');
  const config = loadConfig();
  const drive = new DriveService();
  const sheetsService = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
  await seedPreviouslyContacted(drive, sheetsService, folderId);
}
