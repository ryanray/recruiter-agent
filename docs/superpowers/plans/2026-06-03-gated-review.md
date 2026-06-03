# Gated Human Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a human-in-the-loop gating layer so the agent evaluates candidates and records recommendations, a human approves/rejects/holds in Sheets, and the agent then acts on confirmed decisions.

**Architecture:** The Agent class gains two distinct methods — `evaluateCandidates` (scrapes Indeed, screens, creates Drive folders in "Awaiting Automation Action", writes to Sheets) and `processPendingDecisions` (reads Sheets for human decisions, sends messages, moves Drive folders). Three entry points wire these up: `npm run candidates`, `npm run act`, and `npm start` (both). Sheets gains three new columns: `indeedId`, `agentRecommendation`, `humanDecision`.

**Tech Stack:** TypeScript ESM, Vitest, googleapis, Playwright, Anthropic SDK, Google Maps Distance Matrix API.

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `indeedId`, `agentRecommendation`, `humanDecision` to `CandidateRow`; add `'Awaiting Review'` to `CandidateStatus`; add 3 new methods to `SheetsAdapter`; add `awaiting_action_folder_id` to `Config` |
| `src/adapters/sheets.ts` | Update `COLUMNS` (14 cols, A–N); generalize `updateCandidateStatus`; add `getEvaluatedCandidateIds`, `getCandidatesForAction`, `moveCandidate` |
| `src/fakes/sheets.fake.ts` | Implement the 3 new `SheetsAdapter` methods |
| `src/agent.ts` | Rename core evaluate logic to `evaluateCandidates`; add `processPendingDecisions`; update `run` to call both; uncomment `renderTemplate` import |
| `src/index.ts` | Call `agent.run()` which now handles both (no change to call site) |
| `src/run-candidates.ts` | **New** — entry point for evaluate-only |
| `src/run-act.ts` | **New** — entry point for act-only |
| `package.json` | Add `candidates` and `act` scripts |
| `config.yaml` | Add `google_drive.awaiting_action_folder_id` |
| `smoke/setup-sheets.ts` | Fix OAuth2 (remove service account), update headers to 14-column layout |
| `tests/pipeline.test.ts` | Update evaluate tests (all → Awaiting Review); add processPendingDecisions tests |

---

### Task 1: Update types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update `CandidateRow`**

```typescript
export interface CandidateRow {
  name: string;
  phone: string;
  email: string;
  indeedUrl: string;
  indeedId: string;
  location: string;
  experience: string;
  certifications: string;
  agentRecommendation: string;
  status: CandidateStatus;
  lastContact: string;
  driveFolder?: string;
  humanDecision: string;
  notes: string;
}
```

- [ ] **Step 2: Update `CandidateStatus`**

```typescript
export type CandidateStatus =
  | 'Awaiting Review'
  | 'Screened - Invite Sent'
  | 'Interview Scheduled'
  | 'Cold'
  | 'UNSURE'
  | 'Rejected';
```

- [ ] **Step 3: Add three new methods to `SheetsAdapter`**

```typescript
export interface SheetsAdapter {
  addCandidate(tab: string, candidate: CandidateRow): Promise<void>;
  updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void>;
  getActiveCandidates(): Promise<CandidateRow[]>;
  getEvaluatedCandidateIds(): Promise<Set<string>>;
  getCandidatesForAction(): Promise<CandidateRow[]>;
  moveCandidate(name: string, fromTab: string, toTab: string): Promise<void>;
}
```

- [ ] **Step 4: Add `awaiting_action_folder_id` to `Config`**

```typescript
google_drive: {
  recruiting_root_folder_id: string;
  awaiting_action_folder_id: string;
  checkback_folder_id: string;
  rejected_folder_id: string;
  interview_template_sheet_id: string;
  run_log_doc_id: string;
};
```

- [ ] **Step 5: Verify tests still compile and run**

```bash
npx vitest run
```

Expected: all existing tests pass (types are structural — no runtime breakage yet).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add indeedId/agentRecommendation/humanDecision columns and new SheetsAdapter methods"
```

---

### Task 2: Update FakeSheetsAdapter and write tests for new methods

**Files:**
- Modify: `src/fakes/sheets.fake.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for the three new SheetsAdapter methods**

Add to `tests/pipeline.test.ts`, inside a new `describe('FakeSheetsAdapter new methods')` block. Add this helper at the top of the test file alongside `makeApplicant`:

```typescript
function makeCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    name: 'Jane Doe', phone: '801-555-1234', email: 'jane@example.com',
    indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
    indeedId: 'app-1', location: 'Sandy, UT',
    experience: 'home_care', certifications: '',
    agentRecommendation: 'PASS', status: 'Awaiting Review',
    lastContact: '2026-06-03', driveFolder: '', humanDecision: '', notes: '',
    ...overrides,
  };
}
```

```typescript
describe('FakeSheetsAdapter new methods', () => {
  let sheets: FakeSheetsAdapter;

  beforeEach(() => { sheets = new FakeSheetsAdapter(); });

  it('getEvaluatedCandidateIds returns indeedIds from Active, Rejected, and Checkback Later', async () => {
    sheets.tabs['Active'].push(makeCandidate({ indeedId: 'id-1' }));
    sheets.tabs['Rejected'].push(makeCandidate({ indeedId: 'id-2' }));
    sheets.tabs['Checkback Later'].push(makeCandidate({ indeedId: 'id-3' }));
    const ids = await sheets.getEvaluatedCandidateIds();
    expect(ids.has('id-1')).toBe(true);
    expect(ids.has('id-2')).toBe(true);
    expect(ids.has('id-3')).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('getCandidatesForAction returns only Active rows with non-empty humanDecision', async () => {
    sheets.tabs['Active'].push(makeCandidate({ humanDecision: 'Approve' }));
    sheets.tabs['Active'].push(makeCandidate({ humanDecision: '' }));
    const rows = await sheets.getCandidatesForAction();
    expect(rows).toHaveLength(1);
    expect(rows[0].humanDecision).toBe('Approve');
  });

  it('moveCandidate copies row to destination tab and removes from source', async () => {
    sheets.tabs['Active'].push(makeCandidate({ name: 'Jane Doe', indeedId: 'app-1' }));
    await sheets.moveCandidate('Jane Doe', 'Active', 'Rejected');
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.tabs['Rejected']).toHaveLength(1);
    expect(sheets.tabs['Rejected'][0].name).toBe('Jane Doe');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run
```

Expected: 3 new tests fail with "is not a function".

- [ ] **Step 3: Implement the three new methods in `FakeSheetsAdapter`**

```typescript
import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

export class FakeSheetsAdapter implements SheetsAdapter {
  tabs: Record<string, CandidateRow[]> = {
    Active: [], Rejected: [], Hired: [],
    'Checkback Later': [], 'Communication Log': [],
  };

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
    return this.tabs['Active'].filter(c => c.humanDecision?.trim() !== '');
  }

  async moveCandidate(name: string, fromTab: string, toTab: string): Promise<void> {
    const idx = this.tabs[fromTab]?.findIndex(c => c.name === name) ?? -1;
    if (idx === -1) return;
    const [row] = this.tabs[fromTab].splice(idx, 1);
    if (!this.tabs[toTab]) this.tabs[toTab] = [];
    this.tabs[toTab].push(row);
  }
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npx vitest run
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/fakes/sheets.fake.ts tests/pipeline.test.ts
git commit -m "feat(sheets-fake): add getEvaluatedCandidateIds, getCandidatesForAction, moveCandidate"
```

---

### Task 3: Update SheetsService (real adapter) and setup-sheets smoke script

**Files:**
- Modify: `src/adapters/sheets.ts`
- Modify: `smoke/setup-sheets.ts`

- [ ] **Step 1: Replace COLUMNS and update all range references in `src/adapters/sheets.ts`**

The new column layout is 14 columns (A–N):

```typescript
const COLUMNS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
] as const;

type ColName = typeof COLUMNS[number];
```

Update all range strings from `A:K` / `A2:K` to `A:N` / `A2:N`.

- [ ] **Step 2: Generalize `updateCandidateStatus` to handle any column from `extras`**

```typescript
async updateCandidateStatus(
  name: string,
  status: CandidateStatus,
  extras?: Partial<CandidateRow>
): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: this.spreadsheetId,
    range: 'Active!A:N',
  });
  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex(r => r[0]?.trim() === name.trim());
  if (rowIndex === -1) return;

  const row = [...(rows[rowIndex] as string[])];
  row[COLUMNS.indexOf('status')] = status;
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      const colIdx = COLUMNS.indexOf(key as ColName);
      if (colIdx !== -1) row[colIdx] = String(value ?? '');
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: this.spreadsheetId,
    range: `Active!A${rowIndex + 1}:N${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}
```

- [ ] **Step 3: Update `getActiveCandidates` range to A2:N**

```typescript
async getActiveCandidates(): Promise<CandidateRow[]> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: this.spreadsheetId,
    range: 'Active!A2:N',
  });
  const rows = response.data.values ?? [];
  return rows.map(row => {
    const candidate: Record<string, string> = {};
    COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
    return candidate as unknown as CandidateRow;
  });
}
```

- [ ] **Step 4: Add `getEvaluatedCandidateIds`**

```typescript
async getEvaluatedCandidateIds(): Promise<Set<string>> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const ids = new Set<string>();
  const indeedIdCol = COLUMNS.indexOf('indeedId');

  for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${tab}!A2:N`,
    });
    for (const row of response.data.values ?? []) {
      const id = (row[indeedIdCol] as string | undefined)?.trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}
```

- [ ] **Step 5: Add `getCandidatesForAction`**

```typescript
async getCandidatesForAction(): Promise<CandidateRow[]> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: this.spreadsheetId,
    range: 'Active!A2:N',
  });
  const rows = response.data.values ?? [];
  const humanDecisionCol = COLUMNS.indexOf('humanDecision');
  return rows
    .filter(row => ((row[humanDecisionCol] as string) ?? '').trim() !== '')
    .map(row => {
      const candidate: Record<string, string> = {};
      COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
      return candidate as unknown as CandidateRow;
    });
}
```

- [ ] **Step 6: Add `moveCandidate`**

```typescript
async moveCandidate(name: string, fromTab: string, toTab: string): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

  // Find and read the row from source tab (include header so indices align)
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: this.spreadsheetId,
    range: `${fromTab}!A:N`,
  });
  const rows = readRes.data.values ?? [];
  const rowIndex = rows.findIndex(r => (r[0] as string)?.trim() === name.trim());
  if (rowIndex === -1) return;

  // Append to destination tab
  await sheets.spreadsheets.values.append({
    spreadsheetId: this.spreadsheetId,
    range: `${toTab}!A:N`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rows[rowIndex]] },
  });

  // Get the sheet ID (integer) for the source tab to delete the row
  const meta = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
  const sheetId = meta.data.sheets
    ?.find(s => s.properties?.title === fromTab)
    ?.properties?.sheetId;
  if (sheetId == null) return;

  // Delete the row by index (0-based)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: this.spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
        },
      }],
    },
  });
}
```

- [ ] **Step 7: Rewrite `smoke/setup-sheets.ts` to use OAuth2 and the new 14-column headers**

```typescript
import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../src/google-auth.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;

const CANDIDATE_HEADERS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
];

const TABS = [
  { name: 'Active',           headers: CANDIDATE_HEADERS },
  { name: 'Rejected',         headers: CANDIDATE_HEADERS },
  { name: 'Hired',            headers: CANDIDATE_HEADERS },
  { name: 'Checkback Later',  headers: CANDIDATE_HEADERS },
  { name: 'Communication Log', headers: ['date','candidate','direction','message','channel'] },
];

const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
const existingNames = new Set(
  (spreadsheet.data.sheets ?? []).map(s => s.properties?.title ?? '')
);
console.log('Existing tabs:', [...existingNames].join(', ') || '(none)');

const tabsToCreate = TABS.filter(t => !existingNames.has(t.name));
if (tabsToCreate.length > 0) {
  console.log('Creating tabs:', tabsToCreate.map(t => t.name).join(', '));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: tabsToCreate.map(t => ({ addSheet: { properties: { title: t.name } } })),
    },
  });
}

for (const tab of TABS) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab.name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [tab.headers] },
  });
  console.log(`Headers written to "${tab.name}".`);
}

console.log('\nDone!');
console.log(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
```

- [ ] **Step 8: Clear existing sheet data and re-run setup**

**Manual step:** Open the Google Sheet, select all rows below the header in each tab, delete them (right-click → Delete rows). Then run:

```bash
npx tsx smoke/setup-sheets.ts
```

Expected: "Headers written to Active/Rejected/Hired/Checkback Later/Communication Log."

- [ ] **Step 9: Commit**

```bash
git add src/adapters/sheets.ts smoke/setup-sheets.ts
git commit -m "feat(sheets): 14-column layout with indeedId, agentRecommendation, humanDecision; add getEvaluatedCandidateIds/getCandidatesForAction/moveCandidate"
```

---

### Task 4: Update `agent.evaluateCandidates` — gated flow

All candidates now go to Active with `Awaiting Review` regardless of PASS/FAIL/UNSURE. The Drive folder is always created in `awaiting_action_folder_id`.

**Files:**
- Modify: `src/agent.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Update existing evaluate tests to match new gated behavior**

Replace the existing PASS, FAIL, and UNSURE tests in `tests/pipeline.test.ts`:

```typescript
it('all evaluated candidates go to Active with Awaiting Review regardless of decision', async () => {
  indeed.seedApplicants([makeApplicant()]);
  const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

  await agent.evaluateCandidates(since, new Set(), () => {});

  expect(sheets.tabs['Active']).toHaveLength(1);
  expect(sheets.tabs['Active'][0].status).toBe('Awaiting Review');
  expect(sheets.tabs['Active'][0].agentRecommendation).toBe('PASS');
  expect(sheets.tabs['Active'][0].indeedId).toBe('app-1');
  expect(sheets.tabs['Active'][0].humanDecision).toBe('');
  expect(drive.folders[0].parentId).toBe('awaiting-id');
  expect(indeed.sentMessages).toHaveLength(0);
  expect(indeed.triggeredSchedulers).toHaveLength(0);
});

it('FAIL candidate still gets a Drive folder and Active row', async () => {
  indeed.seedApplicants([makeApplicant()]);
  const agent = new Agent(indeed, sheets, drive, slack, async () => failResult('Too far (40mi)'), config);

  await agent.evaluateCandidates(since, new Set(), () => {});

  expect(sheets.tabs['Active']).toHaveLength(1);
  expect(sheets.tabs['Active'][0].agentRecommendation).toBe('FAIL');
  expect(sheets.tabs['Active'][0].notes).toContain('Too far');
  expect(drive.folders).toHaveLength(1);
  expect(sheets.tabs['Rejected']).toHaveLength(0);
});

it('UNSURE candidate gets Active row and posts Slack alert', async () => {
  indeed.seedApplicants([makeApplicant()]);
  const agent = new Agent(indeed, sheets, drive, slack, async () => unsureResult('Cannot determine distance'), config);

  await agent.evaluateCandidates(since, new Set(), () => {});

  expect(sheets.tabs['Active'][0].agentRecommendation).toBe('UNSURE');
  expect(slack.messages).toHaveLength(1);
  expect(slack.messages[0].message).toContain('Review needed');
});

it('urgent PASS candidate posts Slack alert and still goes to Awaiting Review', async () => {
  indeed.seedApplicants([makeApplicant()]);
  const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(true), config);

  await agent.evaluateCandidates(since, new Set(), () => {});

  expect(sheets.tabs['Active'][0].status).toBe('Awaiting Review');
  expect(slack.messages).toHaveLength(1);
  expect(slack.messages[0].message).toContain('Strong candidate');
});

it('skips candidates whose indeedId is already in Sheets', async () => {
  sheets.tabs['Active'].push(makeCandidate({ indeedId: 'app-1' }));
  indeed.seedApplicants([makeApplicant({ id: 'app-1' })]);
  const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

  const result = await agent.evaluateCandidates(since, new Set(), () => {});

  expect(result.newApplicantsReviewed).toBe(0);
  expect(drive.folders).toHaveLength(0);
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run
```

Expected: new evaluate tests fail.

- [ ] **Step 3: Rewrite the evaluate logic in `src/agent.ts`**

Rename the existing `run` method to `evaluateCandidates`. Remove the old PASS/FAIL/UNSURE branching for Drive/Sheets — all candidates follow a single path:

```typescript
import type {
  IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
  Screener, Config, RunResult, CandidateRow, CandidateStatus,
} from './types.js';
import { renderTemplate } from './messages.js';
import { getGitCommitHash } from './logger.js';

export class Agent {
  constructor(
    private indeed: IndeedAdapter,
    private sheets: SheetsAdapter,
    private drive: DriveAdapter,
    private slack: SlackAdapter,
    private screener: Screener,
    private config: Config,
  ) {}

  async evaluateCandidates(
    since: Date,
    processedIds: Set<string> = new Set(),
    markProcessed: (id: string) => void = () => {},
  ): Promise<RunResult> {
    const startedAt = new Date();
    const result: RunResult = {
      startedAt, completedAt: startedAt, durationMs: 0,
      newApplicantsReviewed: 0, remainingApplicants: 0,
      passed: [], rejected: [], unsure: [],
      bookings: [], coldCandidates: [], errors: [],
      configVersion: getGitCommitHash(),
      screeningCriteria: {
        required: this.config.screening.required,
        preferred: this.config.screening.preferred,
      },
    };

    // Load previously evaluated candidate IDs from Sheets for deduplication
    const evaluatedIds = await this.sheets.getEvaluatedCandidateIds();

    let applicants = (await this.indeed.getNewApplications(since))
      .filter(a => !processedIds.has(a.id) && !evaluatedIds.has(a.id));

    const limit = this.config.run.max_candidates_per_run;
    result.remainingApplicants = limit ? Math.max(0, applicants.length - limit) : 0;
    if (limit) applicants = applicants.slice(0, limit);
    result.newApplicantsReviewed = applicants.length;

    for (const applicant of applicants) {
      console.log(`\n[Agent] Processing: ${applicant.name} (${applicant.location ?? 'no location'})`);
      try {
        console.log(`[Agent] Fetching profile text for ${applicant.name}...`);
        try {
          applicant.resumeText = await this.indeed.fetchProfileText(applicant.indeedProfileUrl);
          console.log(`[Agent] Profile text fetched (${applicant.resumeText.length} chars).`);
        } catch (profileErr) {
          console.log(`[Agent] Could not fetch profile text: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
        }

        console.log(`[Agent] Screening ${applicant.name} with Claude...`);
        const screening = await this.screener(applicant, this.config);
        console.log(`[Agent] Decision: ${screening.decision}${screening.reasons.length ? ' — ' + screening.reasons.join('; ') : ''}`);

        const nameLabel = `${applicant.lastName}, ${applicant.firstName}`;
        const folderName = `${nameLabel} - ${today()}`;

        console.log(`[Agent] Creating Drive folder: "${folderName}"`);
        const folderId = await this.drive.createFolder(
          folderName,
          this.config.google_drive.awaiting_action_folder_id
        );

        console.log(`[Agent] Downloading and uploading resume...`);
        const resume = await this.indeed.downloadResume(applicant.id);
        await this.drive.uploadFile(folderId, 'resume.pdf', resume, 'application/pdf');

        console.log(`[Agent] Copying interview template...`);
        await this.drive.copyTemplate(
          this.config.google_drive.interview_template_sheet_id,
          folderId,
          `Interview Questions: ${nameLabel} - ${today()}`
        );

        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
        console.log(`[Agent] Drive folder ready: ${folderUrl}`);

        const row = this.buildRow(applicant, screening, 'Awaiting Review');
        row.driveFolder = folderUrl;
        row.agentRecommendation = screening.decision;
        row.humanDecision = '';
        row.indeedId = applicant.id;
        row.notes = screening.reasons.join('; ');

        console.log(`[Agent] Adding to Active sheet...`);
        await this.sheets.addCandidate('Active', row);

        if (screening.decision === 'PASS') {
          result.passed.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: screening.extractedData.experienceTypes.join(', '),
            certifications: screening.extractedData.certifications.join(', '),
          });
          if (screening.isUrgent) {
            console.log(`[Agent] Strong candidate — posting Slack alert.`);
            await this.slack.post(
              this.config.slack.recruiting_channel,
              `🚨 *Strong candidate:* ${applicant.name} — CNA + ${screening.extractedData.yearsExperience}yr experience\n${applicant.indeedProfileUrl}`
            );
          }
        } else if (screening.decision === 'FAIL') {
          result.rejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            reason: screening.reasons.join('; '),
          });
        } else {
          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            unclearField: screening.reasons.join('; '),
          });
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `❓ *Review needed:* ${applicant.name} — ${screening.reasons.join('; ')}\n${applicant.indeedProfileUrl}`
          );
        }

        console.log(`[Agent] Done with ${applicant.name}.`);
        markProcessed(applicant.id);

      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Agent] ERROR processing ${applicant.name}: ${reason}`);
        result.errors.push({
          description: `Failed to process ${applicant.name}`,
          reason,
          action: 'Candidate skipped — manual review needed',
        });
      }
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - startedAt.getTime();
    return result;
  }

  async processPendingDecisions(): Promise<void> {
    // Implemented in Task 5
  }

  async run(
    since: Date,
    processedIds: Set<string> = new Set(),
    markProcessed: (id: string) => void = () => {},
  ): Promise<RunResult> {
    const result = await this.evaluateCandidates(since, processedIds, markProcessed);
    await this.processPendingDecisions();
    return result;
  }

  private buildRow(
    applicant: { name: string; phone?: string; email?: string; indeedProfileUrl: string },
    screening: { extractedData: { location?: string | null; experienceTypes: string[]; certifications: string[] } },
    status: CandidateStatus
  ): CandidateRow {
    return {
      name: applicant.name,
      phone: applicant.phone ?? '',
      email: applicant.email ?? '',
      indeedUrl: applicant.indeedProfileUrl,
      indeedId: '',
      location: screening.extractedData.location ?? '',
      experience: screening.extractedData.experienceTypes.join(', '),
      certifications: screening.extractedData.certifications.join(', '),
      agentRecommendation: '',
      status,
      lastContact: today(),
      driveFolder: '',
      humanDecision: '',
      notes: '',
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(agent): gated evaluate — all candidates go to Awaiting Review in awaiting_action folder"
```

---

### Task 5: Implement `agent.processPendingDecisions`

**Files:**
- Modify: `src/agent.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for processPendingDecisions**

Add inside `describe('Agent.run — Phase 1')` in `tests/pipeline.test.ts`:

```typescript
describe('Agent.processPendingDecisions', () => {
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
    // Pre-seed a folder so moves have something to reference
    drive.folders.push({ id: 'folder-1', name: 'Doe, Jane - 2026-06-03', parentId: 'awaiting-id' });
  });

  it('Approve: sends intro message, triggers scheduler, moves folder to root, updates status, clears humanDecision', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', humanDecision: 'Approve',
      driveFolder: 'https://drive.google.com/drive/folders/folder-1',
    }));

    await agent.processPendingDecisions();

    expect(indeed.sentMessages).toHaveLength(1);
    expect(indeed.sentMessages[0].message).toContain('Jane');
    expect(indeed.triggeredSchedulers[0].applicantId).toBe('app-1');
    expect(drive.moves[0].folderId).toBe('folder-1');
    expect(drive.moves[0].targetParentId).toBe('root-id');
    expect(sheets.tabs['Active'][0].status).toBe('Screened - Invite Sent');
    expect(sheets.tabs['Active'][0].humanDecision).toBe('');
  });

  it('Reject: sends rejection, moves folder to rejected folder, moves row to Rejected tab', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', humanDecision: 'Reject',
      driveFolder: 'https://drive.google.com/drive/folders/folder-1',
    }));

    await agent.processPendingDecisions();

    expect(indeed.sentMessages[0].message).toContain('appreciate');
    expect(drive.moves[0].targetParentId).toBe('rejected-id');
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.tabs['Rejected']).toHaveLength(1);
    expect(indeed.triggeredSchedulers).toHaveLength(0);
  });

  it('Checkback Later: moves folder and row, sends no message', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', humanDecision: 'Checkback Later',
      driveFolder: 'https://drive.google.com/drive/folders/folder-1',
    }));

    await agent.processPendingDecisions();

    expect(indeed.sentMessages).toHaveLength(0);
    expect(drive.moves[0].targetParentId).toBe('checkback-id');
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.tabs['Checkback Later']).toHaveLength(1);
  });

  it('Hold: posts Slack alert, clears humanDecision, no folder move', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', humanDecision: 'Hold', agentRecommendation: 'UNSURE',
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      notes: 'Cannot determine distance',
    }));

    await agent.processPendingDecisions();

    expect(indeed.sentMessages).toHaveLength(0);
    expect(drive.moves).toHaveLength(0);
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Jane Doe');
    expect(sheets.tabs['Active'][0].humanDecision).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run
```

Expected: 4 new tests fail.

- [ ] **Step 3: Implement `processPendingDecisions` in `src/agent.ts`**

Replace the stub with the full implementation:

```typescript
async processPendingDecisions(): Promise<void> {
  const candidates = await this.sheets.getCandidatesForAction();
  console.log(`\n[Agent] ${candidates.length} candidate(s) with pending human decisions.`);

  for (const candidate of candidates) {
    const decision = candidate.humanDecision.trim();
    const folderId = candidate.driveFolder?.match(/folders\/([^/?]+)/)?.[1];
    const firstName = candidate.name.split(' ')[0] ?? candidate.name;
    console.log(`[Agent] Acting on ${candidate.name}: ${decision}`);

    try {
      if (decision === 'Approve') {
        await this.indeed.sendMessage(
          candidate.indeedId,
          renderTemplate(this.config.messages.intro, { name: firstName })
        );
        await this.indeed.triggerScheduler(
          candidate.indeedId,
          this.config.scheduling.hiring_team_emails
        );
        if (folderId) {
          await this.drive.moveFolder(folderId, this.config.google_drive.recruiting_root_folder_id);
        }
        await this.sheets.updateCandidateStatus(
          candidate.name, 'Screened - Invite Sent',
          { humanDecision: '', lastContact: today() }
        );

      } else if (decision === 'Reject') {
        await this.indeed.sendMessage(
          candidate.indeedId,
          renderTemplate(this.config.messages.rejection, { name: firstName })
        );
        if (folderId) {
          await this.drive.moveFolder(folderId, this.config.google_drive.rejected_folder_id);
        }
        await this.sheets.moveCandidate(candidate.name, 'Active', 'Rejected');

      } else if (decision === 'Checkback Later') {
        if (folderId) {
          await this.drive.moveFolder(folderId, this.config.google_drive.checkback_folder_id);
        }
        await this.sheets.moveCandidate(candidate.name, 'Active', 'Checkback Later');

      } else if (decision === 'Hold') {
        await this.slack.post(
          this.config.slack.recruiting_channel,
          `🚩 *Hold for review:* ${candidate.name} — Agent: ${candidate.agentRecommendation}\n${candidate.notes}\n${candidate.indeedUrl}`
        );
        await this.sheets.updateCandidateStatus(
          candidate.name, candidate.status,
          { humanDecision: '' }
        );
      }

      console.log(`[Agent] Done acting on ${candidate.name}.`);
    } catch (err) {
      console.error(`[Agent] Error acting on ${candidate.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(agent): implement processPendingDecisions — Approve/Reject/Checkback Later/Hold"
```

---

### Task 6: Add entry points and npm scripts

**Files:**
- Create: `src/run-candidates.ts`
- Create: `src/run-act.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `src/run-candidates.ts`**

```typescript
import 'dotenv/config';
import { loadConfig } from './config.js';
import { readState, writeState, markProcessed } from './state.js';
import { screenApplicant } from './screening.js';
import { formatRunLog } from './logger.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const config = loadConfig();
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');

const indeed = new IndeedService();
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService();
const slack = new SlackService(slackToken);

const state = readState();
const since = state?.lastRunAt ? new Date(state.lastRunAt) : new Date(0);
const processedIds = new Set(state?.processedIds ?? []);

console.log(`[Evaluate] Checking applications since: ${since.toISOString()}`);

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, config);

const timeout = setTimeout(() => {
  console.error('Agent exceeded 30 minute timeout.');
  process.exit(1);
}, 30 * 60 * 1000);

try {
  const result = await agent.evaluateCandidates(since, processedIds, (id) => markProcessed(id));
  clearTimeout(timeout);
  console.log('\n' + formatRunLog(result));
  writeState({ lastRunAt: result.startedAt.toISOString(), processedIds: [...processedIds] });
  console.log(`\nEvaluate complete. Processed ${result.newApplicantsReviewed} applicants.`);
} catch (err) {
  clearTimeout(timeout);
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await indeed.close();
}
```

- [ ] **Step 2: Create `src/run-act.ts`**

```typescript
import 'dotenv/config';
import { loadConfig } from './config.js';
import { screenApplicant } from './screening.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const config = loadConfig();
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');

const indeed = new IndeedService();
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService();
const slack = new SlackService(slackToken);

console.log('[Act] Processing pending human decisions...');

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, config);

const timeout = setTimeout(() => {
  console.error('Agent exceeded 30 minute timeout.');
  process.exit(1);
}, 30 * 60 * 1000);

try {
  await agent.processPendingDecisions();
  clearTimeout(timeout);
  console.log('\n[Act] Complete.');
} catch (err) {
  clearTimeout(timeout);
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await indeed.close();
}
```

- [ ] **Step 3: Update `src/index.ts` to call `agent.run` (no change to call site needed — `run` already calls both)**

Verify `src/index.ts` calls `agent.run(since, processedIds, ...)`. It already does. No change needed.

- [ ] **Step 4: Add scripts to `package.json`**

```json
"scripts": {
  "start": "npx tsx src/index.ts",
  "candidates": "npx tsx src/run-candidates.ts",
  "act": "npx tsx src/run-act.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/run-candidates.ts src/run-act.ts package.json
git commit -m "feat: add npm run candidates and npm run act entry points"
```

---

### Task 7: Update config.yaml and wire up awaiting_action_folder_id

**Files:**
- Modify: `config.yaml`
- Modify: `src/config.ts` (if a separate config loader exists; otherwise `src/types.ts` is already updated)

- [ ] **Step 1: Add `awaiting_action_folder_id` to `config.yaml`**

Open `config.yaml` and add under `google_drive`:

```yaml
google_drive:
  recruiting_root_folder_id: "1jYcRwUmAdjKs17ajEto4weKbkicP4CX3"
  awaiting_action_folder_id: "<paste the ID of your Awaiting Automation Action folder here>"
  checkback_folder_id: "1qSMovk7JilLTJC3iscz5M8GYdRBMXnZj"
  rejected_folder_id: "1Sf0m8rRklyNxkOT-OVwO1l9_H5i47aMJ"
  interview_template_sheet_id: "1XE-v4MQom3PJfkfzk0cIdOYfOMYp3Qlo"
  run_log_doc_id: "1ACCixPnObKbbEFtocylVsON87TlNkySrX5m27e8q8DE"
```

To get the folder ID: open the "Awaiting Automation Action" folder in Google Drive → the ID is the long string at the end of the URL: `https://drive.google.com/drive/folders/<ID>`.

- [ ] **Step 2: Update pipeline test config to include `awaiting_action_folder_id`**

In `tests/pipeline.test.ts`, update the `config` fixture:

```typescript
google_drive: {
  recruiting_root_folder_id: 'root-id',
  awaiting_action_folder_id: 'awaiting-id',
  checkback_folder_id: 'checkback-id',
  rejected_folder_id: 'rejected-id',
  interview_template_sheet_id: 'template-id',
  run_log_doc_id: 'log-id',
},
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test evaluate with `max_candidates_per_run: 1`**

```bash
npm run candidates
```

Expected:
- Browser opens, navigates to Indeed candidates page
- One candidate is found and processed
- Drive folder created in "Awaiting Automation Action"
- Active sheet gains one row with status "Awaiting Review" and an agentRecommendation

- [ ] **Step 5: Test the act flow manually**

Open the Google Sheet, find the row added by the evaluate run, type `Approve` or `Reject` in the `humanDecision` column. Then run:

```bash
npm run act
```

Expected:
- For Approve: intro message sent on Indeed, Drive folder moved to recruiting root, row updated to "Screened - Invite Sent"
- For Reject: rejection message sent, folder moved to _Rejected, row moved to Rejected tab

- [ ] **Step 6: Commit**

```bash
git add config.yaml tests/pipeline.test.ts
git commit -m "feat: wire up awaiting_action_folder_id in config and tests"
```

---

## Self-Review

**Spec coverage:**
- ✅ Evaluate: scrapes Indeed, screens, creates folder in awaiting_action, writes Active row
- ✅ Act: Approve/Reject/Checkback Later/Hold with correct Drive moves and Sheets updates
- ✅ Deduplication: `getEvaluatedCandidateIds` reads Active + Rejected + Checkback Later
- ✅ `indeedId`, `agentRecommendation`, `humanDecision` columns added
- ✅ Three entry points: `npm start`, `npm run candidates`, `npm run act`
- ✅ Folder moves: Approve→root, Reject→rejected, Checkback Later→checkback, Hold→no move
- ✅ Hold clears humanDecision after posting Slack

**Placeholder scan:** None found.

**Type consistency:**
- `CandidateRow.indeedId` used everywhere ✅
- `config.google_drive.awaiting_action_folder_id` used in Task 4 and Task 7 ✅
- `agent.evaluateCandidates` / `agent.processPendingDecisions` / `agent.run` signatures consistent ✅
- `COLUMNS` array drives all sheet reads/writes — all 14 columns accounted for ✅
