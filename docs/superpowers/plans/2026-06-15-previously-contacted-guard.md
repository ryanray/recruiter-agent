# Previously Contacted Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent double-contacting candidates by checking a "Previously Contacted" Sheets tab before screening, flagging matches via Slack, and recording approve/reject outcomes back to the tab automatically.

**Architecture:** A new `Previously Contacted` tab in the existing tracker spreadsheet stores name + date. The agent reads it once per run before the screening loop and posts a Slack alert on any case-insensitive name match within the configured lookback window. After approve or reject decisions, it writes a new row back to the tab. A one-time seed script crawls the legacy Caregiver Applicants Drive folder and populates the tab idempotently.

**Tech Stack:** TypeScript ESM, googleapis, Vitest, existing adapter/fake pattern.

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `PreviouslyContactedEntry`; update `SheetsAdapter`, `DriveAdapter`, `Config` |
| `src/config.ts` | Add `previously_contacted_lookback_days` to REQUIRED_FIELDS |
| `config.yaml` | Add `scheduling.previously_contacted_lookback_days: 365` |
| `tests/config.test.ts` | Add `previously_contacted_lookback_days: 365` to YAML fixture |
| `tests/pipeline.test.ts` | Update config fixture; add 7 new tests |
| `src/fakes/sheets.fake.ts` | Add `previouslyContacted` array; implement two new methods |
| `src/fakes/drive.fake.ts` | Add `seededSubfolders`; implement `listSubfolders` |
| `src/agent.ts` | Add pre-screening guard; add write-back on approve/reject |
| `src/adapters/sheets.ts` | Implement `getPreviouslyContactedNames`, `addToPreviouslyContacted` |
| `src/adapters/drive.ts` | Implement `listSubfolders` |
| `src/scripts/seed-previously-contacted.ts` | **New** — one-time Drive crawl + Sheets write |
| `tests/seed-previously-contacted.test.ts` | **New** — 4 tests for seed logic |
| `package.json` | Add `seed-previously-contacted` script |

---

### Task 1: Update types and test config fixture

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Add `PreviouslyContactedEntry` to `src/types.ts`**

After the `Interview` interface (line 16), insert:

```typescript
export interface PreviouslyContactedEntry {
  name: string;
  lastContact: string; // YYYY-MM-DD
  notes: string;
  indeedId: string; // empty string for seeded rows
}
```

- [ ] **Step 2: Add new methods to `SheetsAdapter` in `src/types.ts`**

Find the `SheetsAdapter` interface and add two methods after `moveCandidate`:

```typescript
  getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]>;
  addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void>;
```

- [ ] **Step 3: Add `listSubfolders` to `DriveAdapter` in `src/types.ts`**

Find the `DriveAdapter` interface and add after `copyTemplate`:

```typescript
  listSubfolders(parentId: string): Promise<{ id: string; name: string }[]>;
```

- [ ] **Step 4: Add `previously_contacted_lookback_days` to `Config` in `src/types.ts`**

Find `Config.scheduling` and add the new field:

```typescript
  scheduling: {
    cold_candidate_days: number;
    hiring_team_emails: string[];
    previously_contacted_lookback_days: number;
  };
```

- [ ] **Step 5: Update config fixture in `tests/pipeline.test.ts`**

Find line 16 (the `scheduling` entry in the `config` constant) and replace:

```typescript
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [] },
```

with:

```typescript
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [], previously_contacted_lookback_days: 365 },
```

- [ ] **Step 6: Run tests to confirm no regressions**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all existing tests pass. (TypeScript type errors would surface here as test failures.)

- [ ] **Step 7: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/types.ts tests/pipeline.test.ts
git commit -m "feat(types): add PreviouslyContactedEntry, update SheetsAdapter, DriveAdapter, Config"
```

---

### Task 2: Config validation and YAML

**Files:**
- Modify: `src/config.ts`
- Modify: `config.yaml`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add required field to `src/config.ts`**

Find `REQUIRED_FIELDS` and add the new entry after `['scheduling', 'cold_candidate_days']`:

```typescript
  ['scheduling', 'previously_contacted_lookback_days'],
```

- [ ] **Step 2: Add field to `config.yaml`**

Find the `scheduling:` section in `config.yaml` and add the new field:

```yaml
scheduling:
  cold_candidate_days: 30          # existing value, do not change
  previously_contacted_lookback_days: 365
```

(Keep any existing fields like `hiring_team_emails` unchanged.)

- [ ] **Step 3: Update `tests/config.test.ts` YAML fixture**

Find the `scheduling:` block in `validYaml` (around line 18) and add the new field:

```
scheduling:
  cold_candidate_days: 3
  previously_contacted_lookback_days: 365
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/config.ts config.yaml tests/config.test.ts
git commit -m "feat(config): require previously_contacted_lookback_days"
```

---

### Task 3: Update fake adapters

**Files:**
- Modify: `src/fakes/sheets.fake.ts`
- Modify: `src/fakes/drive.fake.ts`

- [ ] **Step 1: Rewrite `src/fakes/sheets.fake.ts`**

Replace the entire file with:

```typescript
import type { SheetsAdapter, CandidateRow, CandidateStatus, PreviouslyContactedEntry } from '../types.js';

export class FakeSheetsAdapter implements SheetsAdapter {
  tabs: Record<string, CandidateRow[]> = {
    Active: [], Rejected: [], Hired: [],
    'Checkback Later': [], 'Communication Log': [],
  };
  previouslyContacted: PreviouslyContactedEntry[] = [];

  async addCandidate(tab: string, candidate: CandidateRow): Promise<void> {
    if (!this.tabs[tab]) this.tabs[tab] = [];
    this.tabs[tab].push({ ...candidate });
  }

  async updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void> {
    const candidate = this.tabs['Active'].find(c => c.name === name);
    if (candidate) {
      candidate.status = status;
      if (extras) Object.assign(candidate, extras);
    }
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    return [...this.tabs['Active']];
  }

  async getEvaluatedCandidateIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
      for (const row of this.tabs[tab] ?? []) {
        if (row.indeedId) ids.add(row.indeedId);
      }
    }
    return ids;
  }

  async getCandidatesForAction(): Promise<CandidateRow[]> {
    return this.tabs['Active'].filter(c => !!c.humanDecision?.trim());
  }

  async moveCandidate(name: string, fromTab: string, toTab: string): Promise<void> {
    const idx = this.tabs[fromTab]?.findIndex(c => c.name === name) ?? -1;
    if (idx === -1) return;
    const [row] = this.tabs[fromTab].splice(idx, 1);
    if (!this.tabs[toTab]) this.tabs[toTab] = [];
    this.tabs[toTab].push(row);
  }

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
}
```

- [ ] **Step 2: Rewrite `src/fakes/drive.fake.ts`**

Replace the entire file with:

```typescript
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
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/fakes/sheets.fake.ts src/fakes/drive.fake.ts
git commit -m "feat(fakes): add getPreviouslyContactedNames, addToPreviouslyContacted, listSubfolders"
```

---

### Task 4: Guard in `Agent.evaluateCandidates` — TDD

**Files:**
- Modify: `tests/pipeline.test.ts`
- Modify: `src/agent.ts`

- [ ] **Step 1: Add failing tests to `tests/pipeline.test.ts`**

Inside the outer `describe('Agent.run — Phase 1...')`, after the closing `});` of `Agent.processBookedInterviews` (and before the outer describe's closing `});`), add:

```typescript
  describe('Agent.evaluateCandidates — previously contacted guard', () => {
    let indeed: FakeIndeedAdapter;
    let sheets: FakeSheetsAdapter;
    let drive: FakeDriveAdapter;
    let slack: FakeSlackAdapter;
    const since = new Date('2026-01-01');

    beforeEach(() => {
      indeed = new FakeIndeedAdapter();
      sheets = new FakeSheetsAdapter();
      drive = new FakeDriveAdapter();
      slack = new FakeSlackAdapter();
    });

    it('flags applicant with prior contact within window: notes prefixed + Slack alert', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      sheets.previouslyContacted.push({
        name: 'Jane Doe', lastContact: yesterday, notes: 'Rejected', indeedId: 'old-id',
      });
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      const priorAlert = slack.messages.find(m => m.message.includes('Previously contacted'));
      expect(priorAlert).toBeDefined();
      expect(priorAlert!.message).toContain('Jane Doe');
      expect(sheets.tabs['Active'][0].notes).toMatch(/^\[Previously contacted:/);
    });

    it('does not flag applicant with prior contact outside window', async () => {
      sheets.previouslyContacted.push({
        name: 'Jane Doe', lastContact: '2020-01-01', notes: 'Rejected', indeedId: 'old-id',
      });
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.filter(m => m.message.includes('Previously contacted'))).toHaveLength(0);
      expect(sheets.tabs['Active'][0].notes).not.toContain('[Previously contacted:');
    });

    it('processes normally when no prior contact record exists', async () => {
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.filter(m => m.message.includes('Previously contacted'))).toHaveLength(0);
      expect(sheets.tabs['Active'][0].notes).not.toContain('[Previously contacted:');
    });

    it('matches case-insensitively: lowercase name in tab matches mixed-case applicant', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      sheets.previouslyContacted.push({
        name: 'jane doe', lastContact: yesterday, notes: 'Rejected', indeedId: 'old-id',
      });
      indeed.seedApplicants([makeApplicant({ name: 'Jane Doe' })]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.find(m => m.message.includes('Previously contacted'))).toBeDefined();
    });
  });
```

- [ ] **Step 2: Run to confirm 4 new tests fail**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: 4 failures — the guard logic doesn't exist yet.

- [ ] **Step 3: Implement the guard in `src/agent.ts`**

**Change 1:** Before the applicant loop (after `if (limit) applicants = applicants.slice(0, limit);`), add:

```typescript
    console.log(`[Agent] Loading previously contacted candidates (lookback: ${this.config.scheduling.previously_contacted_lookback_days} days)...`);
    const previouslyContactedEntries = await this.sheets.getPreviouslyContactedNames(
      this.config.scheduling.previously_contacted_lookback_days
    );
    const priorContactMap = new Map(
      previouslyContactedEntries.map(e => [e.name.toLowerCase(), e.lastContact])
    );
    console.log(`[Agent] ${priorContactMap.size} previously contacted candidate(s) in window.`);
```

**Change 2:** Inside the applicant loop, after the profile fetch try/catch block and before the screening log line, add:

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

**Change 3:** Replace the notes assignment line:

Find:
```typescript
        row.notes = screening.reasons.join('; ');
```

Replace with:
```typescript
        const priorNote = priorContact ? `[Previously contacted: ${priorContact}] ` : '';
        row.notes = `${priorNote}${screening.reasons.join('; ')}`;
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass (51 existing + 4 new = 55 total).

- [ ] **Step 5: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(agent): add previously-contacted guard in evaluateCandidates"
```

---

### Task 5: Write-back in `Agent.processPendingDecisions` — TDD

**Files:**
- Modify: `tests/pipeline.test.ts`
- Modify: `src/agent.ts`

- [ ] **Step 1: Add failing tests to `tests/pipeline.test.ts`**

After the `Agent.evaluateCandidates — previously contacted guard` describe block (still inside the outer describe), add:

```typescript
  describe('Agent.processPendingDecisions — previously contacted write-back', () => {
    let indeed: FakeIndeedAdapter;
    let sheets: FakeSheetsAdapter;
    let drive: FakeDriveAdapter;
    let slack: FakeSlackAdapter;
    let agent: Agent;

    beforeEach(() => {
      indeed = new FakeIndeedAdapter();
      sheets = new FakeSheetsAdapter();
      drive = new FakeDriveAdapter();
      slack = new FakeSlackAdapter();
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);
      drive.folders.push({ id: 'folder-1', name: 'Doe, Jane - 2026-06-03', parentId: 'awaiting-id' });
    });

    it('approve writes candidate to Previously Contacted tab', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Approve',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(sheets.previouslyContacted).toHaveLength(1);
      expect(sheets.previouslyContacted[0].name).toBe('Jane Doe');
      expect(sheets.previouslyContacted[0].notes).toBe('Approved - interview sent');
      expect(sheets.previouslyContacted[0].indeedId).toBe('app-1');
      expect(sheets.previouslyContacted[0].lastContact).toBeTruthy();
    });

    it('reject writes candidate to Previously Contacted tab', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Reject',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(sheets.previouslyContacted).toHaveLength(1);
      expect(sheets.previouslyContacted[0].name).toBe('Jane Doe');
      expect(sheets.previouslyContacted[0].notes).toBe('Rejected');
    });

    it('checkback later does not write to Previously Contacted', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Checkback Later',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(sheets.previouslyContacted).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: Run to confirm 3 new tests fail**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: 3 failures — write-back not implemented yet.

- [ ] **Step 3: Add write-back in `src/agent.ts` — approve**

In `processPendingDecisions`, find the approve block. After the final `updateCandidateStatus` call (the one that sets `'Screened - Invite Sent'`), add:

```typescript
          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (approved).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Approved - interview sent',
            indeedId: candidate.indeedId,
          });
```

The approve block after this change ends:
```typescript
          await this.sheets.updateCandidateStatus(
            candidate.name, 'Screened - Invite Sent', { lastContact: today() }
          );

          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (approved).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Approved - interview sent',
            indeedId: candidate.indeedId,
          });

        } else if (decision === 'reject') {
```

- [ ] **Step 4: Add write-back in `src/agent.ts` — reject**

In the reject block, after the `moveCandidate` call, add:

```typescript
          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (rejected).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Rejected',
            indeedId: candidate.indeedId,
          });
```

The reject block after this change ends:
```typescript
          console.log(`[Agent] Moving row to Rejected tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Rejected');

          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (rejected).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Rejected',
            indeedId: candidate.indeedId,
          });

        } else if (decision === 'checkback later') {
```

- [ ] **Step 5: Run tests to confirm all pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass (55 + 3 = 58 total).

- [ ] **Step 6: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(agent): write approve/reject outcomes to Previously Contacted tab"
```

---

### Task 6: Real adapter implementations

**Files:**
- Modify: `src/adapters/sheets.ts`
- Modify: `src/adapters/drive.ts`

No new unit tests — the real adapters call live Google APIs. All behavior is already tested via the fakes.

- [ ] **Step 1: Add `getPreviouslyContactedNames` and `addToPreviouslyContacted` to `src/adapters/sheets.ts`**

After the `COLUMNS` constant near the top of the file, add:

```typescript
const PC_COLUMNS = ['name', 'lastContact', 'notes', 'indeedId'] as const;
```

Add these two methods to the `SheetsService` class (after the `moveCandidate` method):

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
      .map(row => ({
        name: ((row[0] as string) ?? '').trim(),
        lastContact: ((row[1] as string) ?? '').trim(),
      }))
      .filter(e => e.name && /^\d{4}-\d{2}-\d{2}$/.test(e.lastContact))
      .filter(e => cutoff === undefined || e.lastContact >= cutoff);
    console.log(`[Sheets] ${result.length} previously contacted entries returned.`);
    return result;
  }

  async addToPreviouslyContacted(entry: import('../types.js').PreviouslyContactedEntry): Promise<void> {
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

- [ ] **Step 2: Add `listSubfolders` to `src/adapters/drive.ts`**

Add this method to `DriveService` after `copyTemplate`:

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

- [ ] **Step 3: Run tests to confirm all still pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: 58 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/adapters/sheets.ts src/adapters/drive.ts
git commit -m "feat(adapters): implement getPreviouslyContactedNames, addToPreviouslyContacted, listSubfolders"
```

---

### Task 7: Seed script and tests

**Files:**
- Create: `src/scripts/seed-previously-contacted.ts`
- Create: `tests/seed-previously-contacted.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests in `tests/seed-previously-contacted.test.ts`**

Create the file:

```typescript
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
      name: 'Smith, Jane', lastContact: '2025-03-14', notes: 'Seeded from Drive', indeedId: '',
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
});
```

- [ ] **Step 2: Run to confirm 4 tests fail**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: 4 failures — `seedPreviouslyContacted` does not exist yet.

- [ ] **Step 3: Create `src/scripts/seed-previously-contacted.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all tests pass (58 + 4 = 62 total).

- [ ] **Step 5: Add `seed-previously-contacted` script to `package.json`**

Find the `"scripts"` section in `package.json` and add:

```json
"seed-previously-contacted": "npx tsx src/scripts/seed-previously-contacted.ts"
```

The scripts section becomes:

```json
  "scripts": {
    "start": "npx tsx src/index.ts",
    "candidates": "npx tsx src/run-candidates.ts",
    "act": "npx tsx src/run-act.ts",
    "seed-previously-contacted": "npx tsx src/scripts/seed-previously-contacted.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 6: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/scripts/seed-previously-contacted.ts tests/seed-previously-contacted.test.ts package.json
git commit -m "feat: add seed-previously-contacted script with idempotent Drive crawl"
```

---

## Self-Review

**Spec coverage:**
- ✅ `PreviouslyContactedEntry` type — Task 1
- ✅ `getPreviouslyContactedNames(lookbackDays?)` on SheetsAdapter — Tasks 1, 3, 6
- ✅ `addToPreviouslyContacted` on SheetsAdapter — Tasks 1, 3, 6
- ✅ `listSubfolders` on DriveAdapter — Tasks 1, 3, 6
- ✅ `previously_contacted_lookback_days` config field — Tasks 1, 2
- ✅ Guard in `evaluateCandidates`: load once before loop, check per-candidate, Slack alert, notes prefix — Task 4
- ✅ Case-insensitive matching — Task 4 (test + implementation uses `.toLowerCase()`)
- ✅ Write-back on approve — Task 5
- ✅ Write-back on reject — Task 5
- ✅ No write-back on checkback later — Task 5
- ✅ `Previously Contacted` tab column layout (A: name, B: lastContact, C: notes, D: indeedId) — Task 6
- ✅ Seed script: Drive crawl, date parsing, fallback to today, idempotent dedup — Task 7
- ✅ `npm run seed-previously-contacted` — Task 7
- ✅ Logging throughout: `[Agent]`, `[Sheets]`, `[Drive]`, `[Seed]` prefixes — Tasks 4, 5, 6, 7

**Placeholder scan:** None found.

**Type consistency:**
- `PreviouslyContactedEntry` defined in Task 1, used in Tasks 3 (fake), 5 (agent), 6 (sheets adapter), 7 (seed script) — consistent
- `getPreviouslyContactedNames(lookbackDays?: number)` — same signature in types (Task 1), fake (Task 3), agent call (Task 4), real adapter (Task 6), seed script call (Task 7) — consistent
- `addToPreviouslyContacted(entry: PreviouslyContactedEntry)` — consistent throughout
- `listSubfolders(parentId: string)` — consistent throughout
- `seedPreviouslyContacted(drive, sheets, folderId)` — defined in Task 7 Step 3, tested in Task 7 Step 1 — consistent
- `{ added: number; skipped: number }` return type — consistent between implementation and tests
