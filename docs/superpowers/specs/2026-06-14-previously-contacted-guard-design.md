# Previously Contacted Guard Design

## Goal

Prevent the agent from contacting candidates who were previously interviewed or rejected. When a new applicant's name matches a record in a "Previously Contacted" tab, the agent continues processing normally but prepends a warning to the `notes` field and posts a Slack alert so a human can decide before acting. Runs as part of `npm run candidates`.

---

## What Changes

### Modified
- `src/types.ts` — Add `PreviouslyContactedEntry` interface; add `getPreviouslyContactedNames` and `addToPreviouslyContacted` to `SheetsAdapter`; add `listSubfolders` to `DriveAdapter`; add `previously_contacted_lookback_days` to `Config.scheduling`
- `src/config.ts` — Add `['scheduling', 'previously_contacted_lookback_days']` to `REQUIRED_FIELDS`
- `src/agent.ts` — Pre-screening guard in `evaluateCandidates`; write-back in `processPendingDecisions` on approve and reject
- `src/adapters/sheets.ts` — Implement `getPreviouslyContactedNames` and `addToPreviouslyContacted`
- `src/adapters/drive.ts` — Implement `listSubfolders`
- `src/fakes/sheets.fake.ts` — Add `previouslyContacted` array; implement new methods
- `src/fakes/drive.fake.ts` — Add `seededSubfolders`; implement `listSubfolders`
- `config.yaml` — Add `scheduling.previously_contacted_lookback_days`
- `tests/pipeline.test.ts` — Add tests for the guard and write-back
- `package.json` — Add `seed-previously-contacted` script

### New
- `src/scripts/seed-previously-contacted.ts` — One-time Drive crawl script
- `tests/seed-previously-contacted.test.ts` — Tests for seed script logic

### Unchanged
- `DriveAdapter` — `createFolder`, `moveFolder`, `uploadFile`, `copyTemplate` unchanged
- `IndeedAdapter` — unchanged
- `SlackAdapter` — unchanged
- Existing tabs and their column layouts — unchanged

---

## `PreviouslyContactedEntry` Type

```typescript
export interface PreviouslyContactedEntry {
  name: string;
  lastContact: string; // YYYY-MM-DD
  notes: string;
  indeedId: string; // empty string for seeded rows
}
```

---

## Previously Contacted Tab

New tab in the existing tracker spreadsheet. Header row (row 1) is hand-created; the agent and seed script append to row 2 onward.

| Column | Field | Example |
|---|---|---|
| A | name | `Smith, Jane` |
| B | lastContact | `2026-05-15` |
| C | notes | `Rejected` |
| D | indeedId | `abc123` (or empty) |

---

## Config Changes

New required field under `scheduling`:

```yaml
scheduling:
  cold_candidate_days: 30
  previously_contacted_lookback_days: 365
```

`Config.scheduling` type update:
```typescript
scheduling: {
  cold_candidate_days: number;
  hiring_team_emails: string[];
  previously_contacted_lookback_days: number;
};
```

---

## `SheetsAdapter` — New Methods

```typescript
getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]>
addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void>
```

**`getPreviouslyContactedNames` behavior:**
- Reads `Previously Contacted!A2:D`
- When `lookbackDays` is provided: computes a cutoff date (`today - lookbackDays days`); only returns rows where `lastContact` is a valid `YYYY-MM-DD` and `lastContact >= cutoff`
- When `lookbackDays` is `undefined`: returns all rows with a valid `lastContact` (no date filter) — used by the seed script for dedup
- Rows with empty or unparseable `lastContact` are always skipped
- Logs: `[Sheets] Getting previously contacted names (lookback: N days)...` or `[Sheets] Getting all previously contacted names...`; `[Sheets] N entries returned.`

**`addToPreviouslyContacted` behavior:**
- Appends one row to `Previously Contacted!A:D`
- Logs: `[Sheets] Adding <name> to Previously Contacted tab...`

**`SheetsService` implementation detail:**

```typescript
const PC_COLUMNS = ['name', 'lastContact', 'notes', 'indeedId'] as const;
```

```typescript
async getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  if (lookbackDays !== undefined) {
    console.log(`[Sheets] Getting previously contacted names (lookback: ${lookbackDays} days)...`);
  } else {
    console.log('[Sheets] Getting all previously contacted names...');
  }
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: this.spreadsheetId,
    range: 'Previously Contacted!A2:D',
  });
  const rows = response.data.values ?? [];
  const cutoff = lookbackDays !== undefined
    ? new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
    : undefined;
  const result = rows
    .map(row => ({ name: (row[0] as string ?? '').trim(), lastContact: (row[1] as string ?? '').trim() }))
    .filter(e => e.name && /^\d{4}-\d{2}-\d{2}$/.test(e.lastContact))
    .filter(e => cutoff === undefined || e.lastContact >= cutoff);
  console.log(`[Sheets] ${result.length} previously contacted entries returned.`);
  return result;
}

async addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  console.log(`[Sheets] Adding ${entry.name} to Previously Contacted tab...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: this.spreadsheetId,
    range: 'Previously Contacted!A:D',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[entry.name, entry.lastContact, entry.notes, entry.indeedId]] },
  });
}
```

---

## `DriveAdapter` — New Method

```typescript
listSubfolders(parentId: string): Promise<{ id: string; name: string }[]>
```

**`DriveService` implementation:**

```typescript
async listSubfolders(parentId: string): Promise<{ id: string; name: string }[]> {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  console.log(`[Drive] Listing subfolders of ${parentId}...`);
  const response = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1000,
  });
  const files = (response.data.files ?? []).map(f => ({ id: f.id!, name: f.name! }));
  console.log(`[Drive] ${files.length} subfolder(s) found.`);
  return files;
}
```

**`FakeDriveAdapter` addition:**

```typescript
seededSubfolders: { parentId: string; id: string; name: string }[] = [];

async listSubfolders(parentId: string): Promise<{ id: string; name: string }[]> {
  return this.seededSubfolders
    .filter(f => f.parentId === parentId)
    .map(f => ({ id: f.id, name: f.name }));
}
```

---

## Guard in `Agent.evaluateCandidates`

**Before the applicant loop:**

```typescript
console.log(`[Agent] Loading previously contacted candidates (lookback: ${this.config.scheduling.previously_contacted_lookback_days} days)...`);
const previouslyContacted = await this.sheets.getPreviouslyContactedNames(
  this.config.scheduling.previously_contacted_lookback_days
);
const priorContactMap = new Map(
  previouslyContacted.map(e => [e.name.toLowerCase(), e.lastContact])
);
console.log(`[Agent] ${priorContactMap.size} previously contacted candidate(s) in window.`);
```

**Inside the loop, after fetching profile text, before screening:**

```typescript
const priorContact = priorContactMap.get(applicant.name.toLowerCase());
if (priorContact) {
  console.log(`[Agent] ${applicant.name} was previously contacted on ${priorContact} — flagging for human review.`);
  await this.slack.post(
    this.config.slack.recruiting_channel,
    `⚠️ *Previously contacted:* ${applicant.name} — last seen ${priorContact}\nReview before acting: ${applicant.indeedProfileUrl}`
  );
}
```

**When building the row notes field:**

```typescript
const priorNote = priorContact ? `[Previously contacted: ${priorContact}] ` : '';
row.notes = `${priorNote}${screening.reasons.join('; ')}`;
```

(Replace the existing `row.notes = screening.reasons.join('; ')` line.)

Processing continues normally regardless of prior contact: screening runs, Drive folder is created, row is added to Active. The human sees the Slack alert and the note in the sheet before acting.

---

## Write-Back in `Agent.processPendingDecisions`

After a successful `approve` action (after `updateCandidateStatus` to `Screened - Invite Sent`):

```typescript
console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (approved).`);
await this.sheets.addToPreviouslyContacted({
  name: candidate.name,
  lastContact: today(),
  notes: 'Approved - interview sent',
  indeedId: candidate.indeedId,
});
```

After a successful `reject` action (after `moveCandidate` to Rejected):

```typescript
console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (rejected).`);
await this.sheets.addToPreviouslyContacted({
  name: candidate.name,
  lastContact: today(),
  notes: 'Rejected',
  indeedId: candidate.indeedId,
});
```

`checkback later` and `hold` do NOT write to Previously Contacted (no direct contact was made).

---

## Seed Script — `src/scripts/seed-previously-contacted.ts`

**Usage:**
```bash
npm run seed-previously-contacted -- <caregiver-applicants-folder-id>
```

**Logic:**

1. Read folder ID from `process.argv[2]`; exit with usage message if missing
2. Load config (`loadConfig()`)
3. Init `DriveService` and `SheetsService`
4. Read all existing Previously Contacted entries (no lookback filter) to build a dedup set of lowercase names
5. List subfolders of the given folder ID via `listSubfolders`
6. For each subfolder:
   - Extract candidate name from subfolder name
   - Attempt to parse date: match `(\d{4}-\d{2}-\d{2})` at end of name (e.g. `Smith, Jane - 2025-03-14` → `2025-03-14`)
   - If no date found: log warning and use today's date as fallback
   - If name (lowercase) already in dedup set: log skip and continue
   - Append row via `addToPreviouslyContacted`; add name to dedup set
7. Log summary: `N new entries added, M skipped.`

**Exported function (for testability) + top-level entry point:**

```typescript
import { loadConfig } from '../config.js';
import { DriveService } from '../adapters/drive.js';
import { SheetsService } from '../adapters/sheets.js';
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

// Entry point
const folderId = process.argv[2];
if (!folderId) {
  console.error('[Seed] Usage: npm run seed-previously-contacted -- <caregiver-applicants-folder-id>');
  process.exit(1);
}
const config = loadConfig();
const drive = new DriveService();
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
await seedPreviouslyContacted(drive, sheets, folderId);
```

---

## `FakeSheetsAdapter` — Changes

```typescript
previouslyContacted: PreviouslyContactedEntry[] = [];

async getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]> {
  const cutoff = lookbackDays !== undefined
    ? new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
    : undefined;
  return this.previouslyContacted
    .filter(e => !cutoff || e.lastContact >= cutoff)
    .map(e => ({ name: e.name, lastContact: e.lastContact }));
}

async addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void> {
  this.previouslyContacted.push({ ...entry });
}
```

---

## Tests — `tests/pipeline.test.ts`

New describe block: `Agent.evaluateCandidates — previously contacted guard`

1. **Match within window → Slack alert + notes prefixed**
   - Seed `sheets.previouslyContacted` with `{ name: 'Doe, Jane', lastContact: <yesterday>, notes: 'Rejected', indeedId: '' }`
   - Set `config.scheduling.previously_contacted_lookback_days = 365`
   - Run `evaluateCandidates` with an applicant named `'Doe, Jane'`
   - Assert: `slack.messages` has a message containing `'Doe, Jane'` and `'Previously contacted'`
   - Assert: the row added to Active has `notes` starting with `'[Previously contacted:'`

2. **Match outside window → no Slack alert, notes not prefixed**
   - Seed `sheets.previouslyContacted` with `lastContact` 400 days ago
   - Set `previously_contacted_lookback_days = 365`
   - Run `evaluateCandidates`
   - Assert: `slack.messages` is empty (no prior-contact alert)
   - Assert: `notes` does not contain `'Previously contacted'`

3. **No match → processed normally**
   - `sheets.previouslyContacted` empty
   - Assert: `slack.messages` is empty; row notes has no prefix

4. **Case-insensitive match: `'doe, jane'` in tab matches `'Doe, Jane'` applicant**
   - Seed with lowercase name; applicant name has standard casing
   - Assert: Slack alert fires

New describe block: `Agent.processPendingDecisions — previously contacted write-back`

5. **Approve → entry written to Previously Contacted**
   - Candidate with `humanDecision: 'approve'` in Active
   - Call `processPendingDecisions`
   - Assert: `sheets.previouslyContacted` has one entry with `notes: 'Approved - interview sent'`

6. **Reject → entry written to Previously Contacted**
   - Candidate with `humanDecision: 'reject'` in Active
   - Assert: `sheets.previouslyContacted` has one entry with `notes: 'Rejected'`

7. **Checkback Later → no entry written**
   - `humanDecision: 'checkback later'`
   - Assert: `sheets.previouslyContacted` is empty

---

## Tests — `tests/seed-previously-contacted.test.ts`

Extract seed logic into a testable function: `seedPreviouslyContacted(drive, sheets)` in `src/scripts/seed-previously-contacted.ts`. The top-level script calls it after reading `process.argv[2]`.

1. **Adds new entries from Drive subfolders**
   - Seed `FakeDriveAdapter.seededSubfolders` with 2 folders
   - Call `seedPreviouslyContacted(drive, sheets, folderId)`
   - Assert: `sheets.previouslyContacted` has 2 entries

2. **Skips entries already in the tab (idempotent)**
   - Pre-populate `sheets.previouslyContacted` with one entry matching a subfolder name
   - Assert: only 1 new entry added, 1 skipped

3. **Parses date from folder name**
   - Subfolder name: `'Smith, John - 2025-03-14'`
   - Assert: `lastContact === '2025-03-14'`

4. **Falls back to today's date when no date in name**
   - Subfolder name: `'Brown, Alice'`
   - Assert: `lastContact === <today's date>`

---

## What Does NOT Change

- Existing deduplication by `indeedId` via `getEvaluatedCandidateIds` — unchanged; runs before the previously-contacted check
- `markSentiment` / `setupInterview` / `downloadResume` — unchanged
- Drive folder moves on approve/reject — unchanged
- `processBookedInterviews` — unchanged
- `run-act.ts` — unchanged
