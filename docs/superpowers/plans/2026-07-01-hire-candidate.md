# Hire Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a recruiter sets `humanDecision = "Hire"` on a candidate and runs `npm run act`, the agent moves their Drive folder to Active Employees, validates the Offer Info tab, sets their Indeed status to Hired, moves them to the Hired sheet tab, and appends them to the Tracker tab.

**Architecture:** A new `'hire'` branch in `processPendingDecisions()` handles the full sequence. Three new adapter methods (`IndeedService.setStatus`, `DriveService.findSpreadsheetInFolder`, `SheetsService.readOfferInfo`, `SheetsService.addToTracker`) are added behind their existing interfaces. A module-level `validateOfferInfo()` helper checks Offer Info completeness and returns missing field names.

**Tech Stack:** TypeScript ESM, Playwright (Indeed automation), Google Drive API v3, Google Sheets API v4, Vitest

## Global Constraints

- All imports use `.js` extensions (ESM project with `"type": "module"`)
- No `default` imports from CJS modules — use named or dynamic imports
- Run `npm test` after every task — all 90+ tests must stay green
- Do not modify `config.yaml` except to add the new `active_employees_folder_id` field (leave value as `""` — user fills it in)
- Never use `any` — use explicit types everywhere
- Follow the `[Agent]` / `[Indeed]` / `[Drive]` / `[Sheets]` console prefix convention

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `'Onboarding'` to CandidateStatus, add `OfferInfo` interface, add `setStatus` to IndeedAdapter, add `findSpreadsheetInFolder` to DriveAdapter, add `readOfferInfo` + `addToTracker` to SheetsAdapter, add `active_employees_folder_id` to Config |
| `src/config.ts` | Add `active_employees_folder_id` to REQUIRED_FIELDS |
| `config.yaml` | Add `active_employees_folder_id: ""` under `google_drive` |
| `src/fakes/indeed.fake.ts` | Add `statusesSet` tracking array + `setStatus()` stub |
| `src/fakes/drive.fake.ts` | Add `spreadsheetInFolder` field + `findSpreadsheetInFolder()` stub |
| `src/fakes/sheets.fake.ts` | Add `offerInfoBySpreadsheetId` map, `trackerRows` array, `readOfferInfo()` and `addToTracker()` stubs |
| `src/adapters/indeed.ts` | Implement `setStatus()` via Playwright |
| `src/adapters/drive.ts` | Implement `findSpreadsheetInFolder()` via Drive API |
| `src/adapters/sheets.ts` | Implement `readOfferInfo()` and `addToTracker()` via Sheets API |
| `src/agent.ts` | Add `'hire'` branch to `processPendingDecisions()`, add `validateOfferInfo()` helper, import `OfferInfo` |
| `tests/pipeline.test.ts` | Add `active_employees_folder_id` to top-level config const, add `Agent — hire decision` describe block |
| `tests/config.test.ts` | Add `active_employees_folder_id` to `validYaml`, add missing-field test |

---

## Task 1: Foundation — types, config, fakes

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `config.yaml`
- Modify: `src/fakes/indeed.fake.ts`
- Modify: `src/fakes/drive.fake.ts`
- Modify: `src/fakes/sheets.fake.ts`
- Modify: `tests/pipeline.test.ts` (config const only)
- Modify: `tests/config.test.ts`

**Interfaces:**
- Produces: `OfferInfo`, `CandidateStatus` with `'Onboarding'`, all four new adapter method signatures, `Config.google_drive.active_employees_folder_id`, updated fakes that satisfy the compiler

- [ ] **Step 1: Write the failing config test**

Open `tests/config.test.ts`. Add `active_employees_folder_id: "active-employees-id"` to the `validYaml` string inside the `google_drive:` block (after `never_responded_folder_id`):

```ts
const validYaml = `
run:
  trigger: manual
  max_candidates_per_run: 10
  timeout_minutes: 90
screening:
  required:
    - valid_license_and_transportation
    - within_20_miles_south_jordan
  preferred:
    - cna_certification
  disqualifying: []
scheduling:
  cold_candidate_days: 3
  previously_contacted_lookback_days: 365
  follow_up_days: 3
  hiring_team_emails: []
messages:
  interview_request: "Hi {FIRST_NAME}, thanks!"
  interview_follow_up_1: "Hi {FIRST_NAME}, following up!"
  interview_follow_up_2: "Hi {FIRST_NAME}, last follow-up!"
google_drive:
  recruiting_root_folder_id: "root-id"
  awaiting_action_folder_id: "awaiting-id"
  checkback_folder_id: "checkback-id"
  rejected_folder_id: "rejected-id"
  never_responded_folder_id: "never-responded-id"
  active_employees_folder_id: "active-employees-id"
  interview_template_sheet_id: "template-id"
  run_log_doc_id: "log-id"
google_sheets:
  tracker_spreadsheet_id: "sheet-id"
slack:
  recruiting_channel: "#recruiting"
indeed:
  job_ids:
    - test-job-abc
`;
```

Then add this test inside `describe('loadConfig')`:

```ts
it('throws when active_employees_folder_id is missing', () => {
  writeFileSync(
    TEST_CONFIG_PATH,
    validYaml.replace('active_employees_folder_id: "active-employees-id"', 'active_employees_folder_id: ""')
  );
  expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow('google_drive.active_employees_folder_id');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL — `loadConfig` does not throw because `active_employees_folder_id` is not yet in `REQUIRED_FIELDS`.

- [ ] **Step 3: Add `active_employees_folder_id` to REQUIRED_FIELDS in `src/config.ts`**

Find the `REQUIRED_FIELDS` array. Insert after the `never_responded_folder_id` entry:

```ts
const REQUIRED_FIELDS: [string, string][] = [
  ['run', 'trigger'],
  ['screening', 'required'],
  ['scheduling', 'cold_candidate_days'],
  ['scheduling', 'previously_contacted_lookback_days'],
  ['scheduling', 'follow_up_days'],
  ['messages', 'interview_request'],
  ['messages', 'interview_follow_up_1'],
  ['messages', 'interview_follow_up_2'],
  ['google_drive', 'recruiting_root_folder_id'],
  ['google_drive', 'awaiting_action_folder_id'],
  ['google_drive', 'checkback_folder_id'],
  ['google_drive', 'rejected_folder_id'],
  ['google_drive', 'never_responded_folder_id'],
  ['google_drive', 'active_employees_folder_id'],
  ['google_drive', 'interview_template_sheet_id'],
  ['google_drive', 'run_log_doc_id'],
  ['google_sheets', 'tracker_spreadsheet_id'],
  ['slack', 'recruiting_channel'],
];
```

- [ ] **Step 4: Run the config test to verify it passes**

```bash
npm test -- tests/config.test.ts
```

Expected: PASS — all config tests green.

- [ ] **Step 5: Update `src/types.ts`**

Replace the entire file with:

```ts
// --- Domain types ---

export interface Applicant {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  location?: string;
  resumeText?: string;
  // appliedAt: Date;
  indeedProfileUrl: string;
}

export interface Interview {
  applicantId: string;
  applicantName: string;
  scheduledAt: string;
}

export interface PreviouslyContactedEntry {
  name: string;
  lastContact: string; // YYYY-MM-DD
  notes: string;
  indeedId: string; // empty string for seeded rows
}

export interface OfferInfo {
  email: string;
  cellPhone: string;
  startDate: string;
  rateOffered: string;
  justification: string;
}

export type CandidateStatus =
  | 'Awaiting Review'
  | 'Screened - Invite Sent'
  | 'Interview Scheduled'
  | 'Cold'
  | 'UNSURE'
  | 'Rejected'
  | 'Never Responded'
  | 'Onboarding';

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
  score?: string;
  scoreRecommendation?: string;
  scoreTier?: string;
  keyStrengths?: string;
  scoreConcerns?: string;
  interviewQuestions?: string;
  processedAt?: string;
  inviteSentAt?: string;
  interviewScheduledAt?: string;
  inviteCount?: string;
}

export type ExperienceType = 'home_care' | 'care_facility' | 'family' | 'none';

export interface ExtractedProfile {
  location: string | null;
  distanceMiles: number | null;
  hasLicense: boolean | null;
  hasTransportation: boolean | null;
  certifications: string[];
  experienceTypes: ExperienceType[];
  yearsExperience: number | null;
}

export interface ScreeningResult {
  decision: 'PASS' | 'FAIL' | 'UNSURE';
  reasons: string[];
  extractedData: ExtractedProfile;
  isUrgent: boolean;
}

export interface ScoreResult {
  score: number;
  recommendation: 'Strong Interview' | 'Interview' | 'Maybe' | 'Pass';
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
  keyStrengths: string;
  concerns: string;
  interviewQuestions: string;
}

// --- Run result types ---

export interface RunCandidateResult {
  name: string;
  location: string;
  experience: string;
  certifications: string;
  reason?: string;
  unclearField?: string;
}

export interface RunBookingResult {
  name: string;
  scheduledAt: Date;
  driveFolderUrl: string;
}

export interface RunColdResult {
  name: string;
  daysSinceContact: number;
}

export interface RunError {
  description: string;
  reason: string;
  action: string;
}

export interface RunResult {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  newApplicantsReviewed: number;
  remainingApplicants: number;
  passed: RunCandidateResult[];
  rejected: RunCandidateResult[];
  unsure: RunCandidateResult[];
  bookings: RunBookingResult[];
  coldCandidates: RunColdResult[];
  errors: RunError[];
  pdfFailures: string[];
  scoreFailures: string[];
  followUpsSent: { name: string; inviteCount: number }[];
  neverResponded: string[];
  configVersion: string;
  screeningCriteria: {
    required: string[];
    preferred: string[];
  };
}

// --- Adapter interfaces ---

export interface IndeedAdapter {
  getNewApplications(since: Date): Promise<Applicant[]>;
  fetchProfileText(profileUrl: string): Promise<string>;
  markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void>;
  setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void>;
  getBookedInterviews(): Promise<Interview[]>;
  downloadResume(applicantId: string): Promise<Buffer>;
  setStatus(applicantId: string, status: string): Promise<void>;
}

export interface SheetsAdapter {
  addCandidate(tab: string, candidate: CandidateRow): Promise<void>;
  updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void>;
  getActiveCandidates(): Promise<CandidateRow[]>;
  getEvaluatedCandidates(): Promise<{ ids: Set<string>; names: Set<string> }>;
  getCandidatesForAction(): Promise<CandidateRow[]>;
  moveCandidate(name: string, fromTab: string, toTab: string): Promise<void>;
  getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]>;
  addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void>;
  readOfferInfo(spreadsheetId: string): Promise<OfferInfo>;
  addToTracker(lastName: string, firstName: string, startDate: string): Promise<void>;
}

export interface DriveAdapter {
  createFolder(name: string, parentId: string): Promise<string>;
  moveFolder(folderId: string, targetParentId: string): Promise<void>;
  uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void>;
  copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void>;
  listSubfolders(parentId: string): Promise<{ id: string; name: string }[]>;
  findSpreadsheetInFolder(folderId: string): Promise<{ id: string; name: string } | null>;
}

export interface SlackAdapter {
  post(channel: string, message: string): Promise<void>;
}

export type Screener = (applicant: Applicant, config: Config) => Promise<ScreeningResult>;

export type Scorer = (applicant: Applicant, config: Config) => Promise<ScoreResult>;

// --- Config type (mirrors config.yaml) ---

export interface Config {
  run: {
    trigger: 'manual' | 'cron';
    max_candidates_per_run: number | null;
    timeout_minutes: number;
  };
  screening: {
    required: string[];
    preferred: string[];
    disqualifying: string[];
  };
  scheduling: {
    cold_candidate_days: number;
    hiring_team_emails: string[];
    previously_contacted_lookback_days: number;
    follow_up_days: number;
  };
  messages: {
    interview_request: string;
    interview_follow_up_1: string;
    interview_follow_up_2: string;
  };
  google_drive: {
    recruiting_root_folder_id: string;
    awaiting_action_folder_id: string;
    checkback_folder_id: string;
    rejected_folder_id: string;
    never_responded_folder_id: string;
    active_employees_folder_id: string;
    interview_template_sheet_id: string;
    run_log_doc_id: string;
  };
  google_sheets: {
    tracker_spreadsheet_id: string;
  };
  slack: {
    recruiting_channel: string;
  };
  indeed: {
    job_ids: string[];
  };
}
```

- [ ] **Step 6: Update `config.yaml`**

Add `active_employees_folder_id: ""` under `google_drive`, after `never_responded_folder_id`:

```yaml
google_drive:
  recruiting_root_folder_id: "1jYcRwUmAdjKs17ajEto4weKbkicP4CX3"
  awaiting_action_folder_id: "1aqlYeZgmcZkUZhUfXPpPWvNFgGcgbb_p"
  checkback_folder_id: "1qSMovk7JilLTJC3iscz5M8GYdRBMXnZj"
  rejected_folder_id: "1Sf0m8rRklyNxkOT-OVwO1l9_H5i47aMJ"
  never_responded_folder_id: "1NTT7LwX1ZhPVAxAJRKOIks9cyz0F5VK1"
  active_employees_folder_id: ""  # Fill with the Google Drive folder ID for active employees
  interview_template_sheet_id: "1XE-v4MQom3PJfkfzk0cIdOYfOMYp3Qlo"
  run_log_doc_id: "1ACCixPnObKbbEFtocylVsON87TlNkySrX5m27e8q8DE"
```

- [ ] **Step 7: Replace `src/fakes/indeed.fake.ts`**

```ts
import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class FakeIndeedAdapter implements IndeedAdapter {
  private applicants: Applicant[] = [];
  private interviews: Interview[] = [];
  markedSentiments: { applicantId: string; sentiment: string }[] = [];
  interviewsSetUp: { applicantId: string; options: { message: string; hiringTeamEmails: string[] } }[] = [];
  statusesSet: { applicantId: string; status: string }[] = [];

  seedApplicants(applicants: Applicant[]): void {
    this.applicants = applicants;
  }

  seedInterviews(interviews: Interview[]): void {
    this.interviews = interviews;
  }

  async getNewApplications(_since: Date): Promise<Applicant[]> {
    return [...this.applicants];
  }

  async fetchProfileText(_profileUrl: string): Promise<string> {
    return 'Fake profile text';
  }

  async markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void> {
    this.markedSentiments.push({ applicantId, sentiment });
  }

  async setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void> {
    this.interviewsSetUp.push({ applicantId, options });
  }

  async getBookedInterviews(): Promise<Interview[]> {
    return this.interviews;
  }

  async downloadResume(applicantId: string): Promise<Buffer> {
    return Buffer.from(`Resume content for applicant ${applicantId}`);
  }

  async setStatus(applicantId: string, status: string): Promise<void> {
    this.statusesSet.push({ applicantId, status });
  }
}
```

- [ ] **Step 8: Replace `src/fakes/drive.fake.ts`**

```ts
import type { DriveAdapter } from '../types.js';

export class FakeDriveAdapter implements DriveAdapter {
  folders: { id: string; name: string; parentId: string }[] = [];
  files: { folderId: string; name: string; content: Buffer; mimeType: string }[] = [];
  copies: { templateId: string; destFolderId: string; name: string }[] = [];
  moves: { folderId: string; targetParentId: string }[] = [];
  seededSubfolders: { parentId: string; id: string; name: string }[] = [];
  spreadsheetInFolder: { id: string; name: string } | null = { id: 'fake-sheet-id', name: 'Interview Questions' };
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

  async findSpreadsheetInFolder(_folderId: string): Promise<{ id: string; name: string } | null> {
    return this.spreadsheetInFolder;
  }
}
```

- [ ] **Step 9: Replace `src/fakes/sheets.fake.ts`**

```ts
import type { SheetsAdapter, CandidateRow, CandidateStatus, PreviouslyContactedEntry, OfferInfo } from '../types.js';

export class FakeSheetsAdapter implements SheetsAdapter {
  tabs: Record<string, CandidateRow[]> = {
    Active: [], Rejected: [], Hired: [],
    'Checkback Later': [], 'Communication Log': [],
  };
  previouslyContacted: PreviouslyContactedEntry[] = [];
  offerInfoBySpreadsheetId: Map<string, OfferInfo> = new Map();
  trackerRows: { lastName: string; firstName: string; startDate: string }[] = [];

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

  async getEvaluatedCandidates(): Promise<{ ids: Set<string>; names: Set<string> }> {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
      for (const row of this.tabs[tab] ?? []) {
        if (row.indeedId) ids.add(row.indeedId);
        if (row.name) names.add(row.name.toLowerCase());
      }
    }
    return { ids, names };
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

  async readOfferInfo(spreadsheetId: string): Promise<OfferInfo> {
    return this.offerInfoBySpreadsheetId.get(spreadsheetId) ?? {
      email: '', cellPhone: '', startDate: '', rateOffered: '', justification: '',
    };
  }

  async addToTracker(lastName: string, firstName: string, startDate: string): Promise<void> {
    this.trackerRows.push({ lastName, firstName, startDate });
  }
}
```

- [ ] **Step 10: Update the top-level `config` const in `tests/pipeline.test.ts`**

Add `active_employees_folder_id: 'active-employees-id'` to the `google_drive` section of the `config` const near the top of the file:

```ts
const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null, timeout_minutes: 90 },
  screening: {
    required: ['valid_license_and_transportation', 'within_30_miles_south_jordan'],
    preferred: ['cna_certification'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [], previously_contacted_lookback_days: 365, follow_up_days: 3 },
  messages: {
    interview_request: 'Hi {FIRST_NAME}, thanks for applying!',
    interview_follow_up_1: 'Hi {FIRST_NAME}, following up!',
    interview_follow_up_2: 'Hi {FIRST_NAME}, last follow-up!',
  },
  google_drive: {
    recruiting_root_folder_id: 'root-id',
    awaiting_action_folder_id: 'awaiting-id',
    checkback_folder_id: 'checkback-id',
    rejected_folder_id: 'rejected-id',
    never_responded_folder_id: 'never-responded-id',
    active_employees_folder_id: 'active-employees-id',
    interview_template_sheet_id: 'template-id',
    run_log_doc_id: 'log-id',
  },
  google_sheets: { tracker_spreadsheet_id: 'sheet-id' },
  slack: { recruiting_channel: '#recruiting' },
  indeed: { job_ids: ['test-job-1'] },
};
```

- [ ] **Step 11: Run the full test suite**

```bash
npm test
```

Expected: All 90+ tests PASS. TypeScript must compile without errors (any type error = fix before continuing).

- [ ] **Step 12: Commit**

```bash
git add src/types.ts src/config.ts config.yaml \
  src/fakes/indeed.fake.ts src/fakes/drive.fake.ts src/fakes/sheets.fake.ts \
  tests/pipeline.test.ts tests/config.test.ts
git commit -m "feat(hire): add types, config, and fake stubs for hire flow"
```

---

## Task 2: Adapter implementations

**Files:**
- Modify: `src/adapters/indeed.ts`
- Modify: `src/adapters/drive.ts`
- Modify: `src/adapters/sheets.ts`

**Interfaces:**
- Consumes: `IndeedAdapter.setStatus`, `DriveAdapter.findSpreadsheetInFolder`, `SheetsAdapter.readOfferInfo`, `SheetsAdapter.addToTracker` (all from Task 1 `src/types.ts`)
- Produces: Real implementations of all four methods

- [ ] **Step 1: Add `setStatus()` to `src/adapters/indeed.ts`**

Add this method to the `IndeedService` class (after `downloadResume`):

```ts
async setStatus(applicantId: string, status: string): Promise<void> {
  const page = await this.getPage();
  console.log(`[Indeed] Setting status "${status}" for applicant ${applicantId}...`);
  await jitter(400, 900);
  await page.goto(`https://employers.indeed.com/candidates/view?id=${applicantId}`);
  await page.waitForSelector('[data-testid="load-complete"]', { state: 'attached', timeout: 30_000 });
  await jitter(500, 1000);

  console.log('[Indeed] Opening status menu...');
  await page.click('[data-testid="Status-Menu"]');
  await page.waitForSelector('[role="listbox"]', { timeout: 10_000 });
  await jitter(300, 600);

  const options = await page.$$('[role="option"]');
  let clicked = false;
  for (const option of options) {
    const text = ((await option.textContent()) ?? '').trim();
    if (text.toLowerCase() === status.toLowerCase()) {
      await option.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error(`Indeed status option "${status}" not found in menu`);

  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 10_000 });
  await jitter(300, 700);
  console.log(`[Indeed] Status set to "${status}".`);
}
```

- [ ] **Step 2: Add `findSpreadsheetInFolder()` to `src/adapters/drive.ts`**

Add this method to the `DriveService` class (after `listSubfolders`):

```ts
async findSpreadsheetInFolder(folderId: string): Promise<{ id: string; name: string } | null> {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  console.log(`[Drive] Looking for spreadsheet in folder ${folderId}...`);
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = response.data.files ?? [];
  if (files.length === 0) {
    console.log('[Drive] No spreadsheet found in folder.');
    return null;
  }
  const file = { id: files[0].id!, name: files[0].name! };
  console.log(`[Drive] Found spreadsheet: "${file.name}" (${file.id})`);
  return file;
}
```

- [ ] **Step 3: Add `readOfferInfo()` and `addToTracker()` to `src/adapters/sheets.ts`**

First, add the `OfferInfo` import to the top of the file:

```ts
import type { SheetsAdapter, CandidateRow, CandidateStatus, PreviouslyContactedEntry, OfferInfo } from '../types.js';
```

Then add these two methods to the `SheetsService` class (after `addToPreviouslyContacted`):

```ts
async readOfferInfo(spreadsheetId: string): Promise<OfferInfo> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  console.log(`[Sheets] Reading Offer Info tab from spreadsheet ${spreadsheetId}...`);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Offer Info'!B2:B7",
  });
  const values = response.data.values ?? [];
  const cell = (row: number): string => ((values[row]?.[0] as string | undefined) ?? '').trim();
  return {
    email: cell(0),       // B2
    cellPhone: cell(1),   // B3
    startDate: cell(2),   // B4
    // B5 (index 3) is a spacer row — skipped
    rateOffered: cell(4), // B6
    justification: cell(5), // B7
  };
}

async addToTracker(lastName: string, firstName: string, startDate: string): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  console.log(`[Sheets] Adding ${lastName}, ${firstName} to Tracker tab...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: this.spreadsheetId,
    range: 'Tracker!A:D',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[lastName, firstName, 'Onboarding', startDate]] },
  });
}
```

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: All tests PASS. No TypeScript errors (the compiler validates all four implementations satisfy their interface signatures).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/indeed.ts src/adapters/drive.ts src/adapters/sheets.ts
git commit -m "feat(hire): implement setStatus, findSpreadsheetInFolder, readOfferInfo, addToTracker"
```

---

## Task 3: Agent hire branch and tests

**Files:**
- Modify: `src/agent.ts`
- Modify: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `OfferInfo` (Task 1), `drive.findSpreadsheetInFolder` (Task 2), `sheets.readOfferInfo` (Task 2), `sheets.addToTracker` (Task 2), `indeed.setStatus` (Task 2), `FakeDriveAdapter.spreadsheetInFolder` (Task 1), `FakeSheetsAdapter.offerInfoBySpreadsheetId` and `trackerRows` (Task 1), `FakeIndeedAdapter.statusesSet` (Task 1)
- Produces: `processPendingDecisions()` handling `'hire'`

- [ ] **Step 1: Write failing tests**

Add this `describe` block to the end of `tests/pipeline.test.ts`:

```ts
describe('Agent — hire decision', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
  });

  function makeHireCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
    return {
      name: 'Ray, Ryan', phone: '801-555-1234', email: 'ryan@example.com',
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      indeedId: 'app-1', location: 'Sandy, UT',
      experience: 'home_care', certifications: '',
      agentRecommendation: 'PASS', status: 'Interview Scheduled',
      lastContact: '2026-06-15', driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      humanDecision: 'Hire', notes: '',
      ...overrides,
    };
  }

  function makeOfferInfo(overrides: Partial<import('../src/types.js').OfferInfo> = {}): import('../src/types.js').OfferInfo {
    return {
      email: 'ryan@example.com',
      cellPhone: '801-555-1234',
      startDate: '2026-07-15',
      rateOffered: '15',
      justification: '',
      ...overrides,
    };
  }

  it('full happy path: folder moved, offer info valid, Indeed status set, row moved to Hired, Tracker row appended', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo());
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(drive.moves).toContainEqual({ folderId: 'folder-1', targetParentId: 'active-employees-id' });
    expect(indeed.statusesSet).toContainEqual({ applicantId: 'app-1', status: 'Hired' });
    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.trackerRows).toContainEqual({ lastName: 'Ray', firstName: 'Ryan', startDate: '2026-07-15' });
    expect(slack.messages).toHaveLength(0);
  });

  it('posts Slack @here alert when offer info has missing fields, hire still completes', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo({ email: '', cellPhone: '' }));
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('@here');
    expect(slack.messages[0].message).toContain('Ray, Ryan');
    expect(slack.messages[0].message).toContain('Click here');
    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.trackerRows).toHaveLength(1);
  });

  it('includes justification in missing fields when rate > 16 and justification is blank', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo({ rateOffered: '17', justification: '' }));
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('justification');
  });

  it('does not flag justification as missing when rate is exactly 16', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo({ rateOffered: '16', justification: '' }));
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(0);
  });

  it('posts Slack alert about missing sheet when no spreadsheet found in folder, hire still completes', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    drive.spreadsheetInFolder = null;
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Ray, Ryan');
    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.trackerRows).toContainEqual({ lastName: 'Ray', firstName: 'Ryan', startDate: '' });
  });

  it('logs error and continues when setStatus throws — row still moved, Tracker still written', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo());
    indeed.setStatus = async () => { throw new Error('Indeed API error'); };
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.trackerRows).toHaveLength(1);
  });

  it('logs error and skips Tracker when moveCandidate throws', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo());
    sheets.moveCandidate = async () => { throw new Error('Sheets API error'); };
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(sheets.trackerRows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/pipeline.test.ts
```

Expected: All 6 new tests FAIL with `'hire'` not recognized as a humanDecision (the unrecognized decision path logs a warning and skips).

- [ ] **Step 3: Add the hire branch to `src/agent.ts`**

Add `OfferInfo` to the import at the top of the file:

```ts
import type {
  IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
  Screener, Scorer, Config, RunResult, CandidateRow, CandidateStatus, OfferInfo,
} from './types.js';
```

Then inside `processPendingDecisions()`, add the `'hire'` branch after the `'hold'` branch, before the `else`:

```ts
} else if (decision === 'hire') {
  console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
  await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

  // Step 1: Move Drive folder to Active Employees
  if (folderId) {
    console.log(`[Agent] Moving Drive folder to Active Employees...`);
    await this.drive.moveFolder(folderId, this.config.google_drive.active_employees_folder_id);
  } else {
    console.warn(`[Agent] No Drive folder found for ${candidate.name} — skipping folder move.`);
  }

  // Step 2: Validate Offer Info tab
  let offerInfo: OfferInfo | null = null;
  const spreadsheet = folderId
    ? await this.drive.findSpreadsheetInFolder(folderId)
    : null;

  if (!spreadsheet) {
    console.warn(`[Agent] No spreadsheet found in folder for ${candidate.name} — skipping Offer Info check.`);
    await this.slack.post(
      this.config.slack.recruiting_channel,
      `@here Action required: could not find interview questions sheet for ${candidate.name}. Please verify their Drive folder.`
    );
  } else {
    console.log(`[Agent] Reading Offer Info tab...`);
    offerInfo = await this.sheets.readOfferInfo(spreadsheet.id);
    const missingFields = validateOfferInfo(offerInfo);
    if (missingFields.length > 0) {
      console.warn(`[Agent] Missing offer info for ${candidate.name}: ${missingFields.join(', ')}`);
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.id}/edit`;
      await this.slack.post(
        this.config.slack.recruiting_channel,
        `@here Action required: missing offer info for ${candidate.name}. <${sheetUrl}|Click here>`
      );
    } else {
      console.log(`[Agent] Offer info valid — start date: ${offerInfo.startDate}, rate: $${offerInfo.rateOffered}/hr`);
    }
  }

  // Step 3: Set Indeed status to Hired (non-fatal if it fails)
  console.log(`[Agent] Setting Indeed status to Hired...`);
  try {
    await this.indeed.setStatus(candidate.indeedId, 'Hired');
  } catch (err) {
    console.error(`[Agent] Failed to set Indeed status for ${candidate.name}: ${err instanceof Error ? err.message : err}`);
  }

  // Step 4: Move row to Hired tab (fatal — if this fails, skip Tracker)
  console.log(`[Agent] Moving row to Hired tab...`);
  await this.sheets.moveCandidate(candidate.name, 'Active', 'Hired');

  // Step 5: Add to Tracker
  console.log(`[Agent] Adding ${candidate.name} to Tracker...`);
  await this.sheets.addToTracker(lastName, firstName, offerInfo?.startDate ?? '');
```

Then add the `validateOfferInfo` helper function at the bottom of the file alongside the existing `today()` function:

```ts
function validateOfferInfo(info: OfferInfo): string[] {
  const missing: string[] = [];
  if (!info.email) missing.push('email');
  if (!info.cellPhone) missing.push('cell phone');
  if (!info.startDate) missing.push('start date');
  if (!info.rateOffered) missing.push('rate offered');
  if (info.rateOffered && parseFloat(info.rateOffered) > 16 && !info.justification) {
    missing.push('justification (rate > $16)');
  }
  return missing;
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
npm test -- tests/pipeline.test.ts
```

Expected: All 6 new tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: All tests PASS (90+ existing + 6 new = 96+).

- [ ] **Step 6: Commit**

```bash
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(hire): add hire decision branch to processPendingDecisions"
```

---

## Post-implementation checklist

After all tasks are complete:

- [ ] Fill in `active_employees_folder_id` in `config.yaml` with the real Google Drive folder ID
- [ ] Create a `Hired` tab in the recruiter spreadsheet (same A–X column layout as Active)
- [ ] Confirm the `Tracker` tab exists in the same spreadsheet with headers in row 1 (Last Name in A, First Name in B, Status in C, Start Date in D)
