# Follow-Up Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically send up to 2 follow-up interview invites to non-responding candidates, then move them to a "Never Responded" tab and Drive folder after 3 total unanswered invites.

**Architecture:** A new `processFollowUps()` method on `Agent` is called from `run-act.ts` after existing methods. It reads `Screened - Invite Sent` candidates, checks `lastContact` age against a configurable `follow_up_days` threshold, sends the appropriate follow-up message via `setupInterview`, and moves exhausted candidates to Never Responded. `inviteCount` is tracked as a new sheet column (X). Two new configurable follow-up messages live in `config.yaml` alongside the existing `interview_request`.

**Tech Stack:** TypeScript ESM, Vitest, Google Sheets API (googleapis), Playwright/Indeed adapter

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `'Never Responded'` to `CandidateStatus`; add `inviteCount?` to `CandidateRow`; add `follow_up_days` to `Config.scheduling`; add `interview_follow_up_1`/`2` to `Config.messages`; add `never_responded_folder_id` to `Config.google_drive`; add `followUpsSent`/`neverResponded` to `RunResult` |
| `src/config.ts` | Add `messages.interview_follow_up_1`, `messages.interview_follow_up_2`, `scheduling.follow_up_days`, `google_drive.never_responded_folder_id` to `REQUIRED_FIELDS` |
| `config.yaml` | Add `scheduling.follow_up_days`, `messages.interview_follow_up_1`, `messages.interview_follow_up_2`, `google_drive.never_responded_folder_id` |
| `src/adapters/sheets.ts` | Add `'inviteCount'` to `COLUMNS`; update ranges from `A:W` → `A:X` and `A2:W` → `A2:X` |
| `src/fakes/sheets.fake.ts` | No change needed — `updateCandidateStatus` already supports arbitrary extras; `moveCandidate` already supports arbitrary tab names |
| `src/agent.ts` | Add `processFollowUps()` method; set `inviteCount: '1'` when first invite is sent in `processPendingDecisions` |
| `src/logger.ts` | Add `FOLLOW-UPS SENT` and `NEVER RESPONDED` sections to `formatRunLog` |
| `src/run-act.ts` | Call `agent.processFollowUps()` after `processBookedInterviews()` |
| `src/scripts/add-score-columns.ts` | Add `'Invite Count'` to `EXPECTED_HEADERS`; add `'Never Responded'` to `TABS` |
| `tests/pipeline.test.ts` | Add `Agent.processFollowUps` describe block with 8 tests; update config object with new fields; update `makeCandidate` default to include `run.timeout_minutes` |
| `tests/config.test.ts` | Add new required fields to `validYaml` fixture |

---

## Task 1: Update types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Make all type changes**

In `src/types.ts`, make these 5 changes:

**1. Add `'Never Responded'` to `CandidateStatus`:**
```ts
export type CandidateStatus =
  | 'Awaiting Review'
  | 'Screened - Invite Sent'
  | 'Interview Scheduled'
  | 'Cold'
  | 'UNSURE'
  | 'Rejected'
  | 'Never Responded';
```

**2. Add `inviteCount?` to `CandidateRow` after `interviewScheduledAt`:**
```ts
  interviewScheduledAt?: string;
  inviteCount?: string;
```

**3. Add `followUpsSent` and `neverResponded` to `RunResult` after `scoreFailures`:**
```ts
  scoreFailures: string[];
  followUpsSent: { name: string; inviteCount: number }[];
  neverResponded: string[];
```

**4. Add `follow_up_days` to `Config.scheduling`:**
```ts
  scheduling: {
    cold_candidate_days: number;
    hiring_team_emails: string[];
    previously_contacted_lookback_days: number;
    follow_up_days: number;
  };
```

**5. Add follow-up messages to `Config.messages` and `never_responded_folder_id` to `Config.google_drive`:**
```ts
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
    interview_template_sheet_id: string;
    run_log_doc_id: string;
  };
```

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
npm test
```

Expected: all existing tests pass (TypeScript errors will appear in other files — that's expected at this stage; vitest only checks runtime behaviour of the test files which use the types).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add Never Responded status, inviteCount, follow-up config fields, RunResult follow-up arrays"
```

---

## Task 2: Update config.ts and config.yaml

**Files:**
- Modify: `src/config.ts`
- Modify: `config.yaml`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add new required fields to config.ts**

In `src/config.ts`, update `REQUIRED_FIELDS` to add:

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
  ['google_drive', 'interview_template_sheet_id'],
  ['google_drive', 'run_log_doc_id'],
  ['google_sheets', 'tracker_spreadsheet_id'],
  ['slack', 'recruiting_channel'],
];
```

- [ ] **Step 2: Add new fields to config.yaml**

In `config.yaml`, add under `scheduling`:
```yaml
scheduling:
  cold_candidate_days: 3
  previously_contacted_lookback_days: 365
  follow_up_days: 3
  hiring_team_emails: ["rray@firstlighthomecare.com", "jray@firstlighthomecare.com", "ashumway@firstlighthomecare.com"]
```

Add under `messages`:
```yaml
messages:
  interview_request: "Hi {FIRST_NAME}, thank you for applying to FirstLight Home Care of South Jordan! I am impressed with your background and would love to set up a quick phone call so that we can tell you more about us and the position as well as learn more about your background. Please use the link below to schedule a time that works for you."
  interview_follow_up_1: "Hi {FIRST_NAME}, I wanted to follow up on my previous message about the caregiver position at FirstLight Home Care of South Jordan. We are still very interested in speaking with you! Please use the link below to schedule a quick phone call at your convenience."
  interview_follow_up_2: "Hi {FIRST_NAME}, this is my final follow-up regarding the caregiver opportunity at FirstLight Home Care of South Jordan. If you are still interested, please use the link below to schedule a call — we would love to connect. If now is not the right time, no worries at all!"
```

Add under `google_drive`:
```yaml
google_drive:
  recruiting_root_folder_id: "1jYcRwUmAdjKs17ajEto4weKbkicP4CX3"
  awaiting_action_folder_id: "1aqlYeZgmcZkUZhUfXPpPWvNFgGcgbb_p"
  checkback_folder_id: "1qSMovk7JilLTJC3iscz5M8GYdRBMXnZj"
  rejected_folder_id: "1Sf0m8rRklyNxkOT-OVwO1l9_H5i47aMJ"
  never_responded_folder_id: "REPLACE_WITH_ACTUAL_FOLDER_ID"
  interview_template_sheet_id: "1XE-v4MQom3PJfkfzk0cIdOYfOMYp3Qlo"
  run_log_doc_id: "1ACCixPnObKbbEFtocylVsON87TlNkySrX5m27e8q8DE"
```

**Note:** Replace `REPLACE_WITH_ACTUAL_FOLDER_ID` with the real Google Drive folder ID before running. The user must create this folder manually in Google Drive first.

- [ ] **Step 3: Update tests/config.test.ts validYaml fixture**

In `tests/config.test.ts`, update the `validYaml` string to include all new fields:

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

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts config.yaml tests/config.test.ts
git commit -m "feat(config): add follow_up_days, interview follow-up messages, never_responded_folder_id"
```

---

## Task 3: Update sheets.ts (add inviteCount column, extend ranges)

**Files:**
- Modify: `src/adapters/sheets.ts`

- [ ] **Step 1: Add inviteCount to COLUMNS and update ranges**

In `src/adapters/sheets.ts`:

**Update COLUMNS** (add `'inviteCount'` after `'interviewScheduledAt'`):
```ts
const COLUMNS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
  'score','scoreRecommendation','scoreTier','keyStrengths','scoreConcerns','interviewQuestions',
  'processedAt','inviteSentAt','interviewScheduledAt','inviteCount',
] as const;
```

**Update all range strings** from `A:W` → `A:X` and `A2:W` → `A2:X` and `A${n}:W${n}` → `A${n}:X${n}`. There are 8 occurrences total — search for `:W` and replace each with `:X`.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/sheets.ts
git commit -m "feat(sheets): add inviteCount column X, update ranges to A:X"
```

---

## Task 4: Update pipeline.test.ts config + add processFollowUps tests

**Files:**
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Update the config object in pipeline.test.ts**

Find the `const config: Config = {` block at the top of `tests/pipeline.test.ts` and update it to include all new fields:

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
    interview_template_sheet_id: 'template-id',
    run_log_doc_id: 'log-id',
  },
  google_sheets: { tracker_spreadsheet_id: 'sheet-id' },
  slack: { recruiting_channel: '#recruiting' },
  indeed: { job_ids: ['test-job-1'] },
};
```

- [ ] **Step 2: Write the failing tests for processFollowUps**

Add this describe block at the end of `tests/pipeline.test.ts`, before the final closing `});` of the outermost describe (or after the last describe block):

```ts
describe('Agent.processFollowUps', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;
  let agent: Agent;

  // A candidate who got invite #1 and has not responded for 4 days (past threshold)
  function staleCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    return makeCandidate({
      status: 'Screened - Invite Sent',
      indeedId: 'app-1',
      inviteCount: '1',
      lastContact: fourDaysAgo,
      driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      ...overrides,
    });
  }

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
    drive.folders.push({ id: 'folder-1', name: 'Doe, Jane - 2026-06-03', parentId: 'root-id' });
    agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
  });

  it('sends follow-up 1 when inviteCount=1 and past threshold', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '1' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(1);
    expect(indeed.interviewsSetUp[0].options.message).toContain('following up');
    const updated = sheets.tabs['Active'][0];
    expect(updated.inviteCount).toBe('2');
    expect(updated.lastContact).toBe(new Date().toISOString().slice(0, 10));
  });

  it('sends follow-up 2 when inviteCount=2 and past threshold', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '2' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(1);
    expect(indeed.interviewsSetUp[0].options.message).toContain('last follow-up');
    const updated = sheets.tabs['Active'][0];
    expect(updated.inviteCount).toBe('3');
  });

  it('moves to Never Responded when inviteCount=3 and past threshold', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '3' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(0);
    expect(drive.moves).toHaveLength(1);
    expect(drive.moves[0].targetParentId).toBe('never-responded-id');
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.tabs['Never Responded']).toHaveLength(1);
  });

  it('skips candidate within follow_up_days threshold', async () => {
    const yesterday = new Date(Date.now() - 1 * 86_400_000).toISOString().slice(0, 10);
    sheets.tabs['Active'].push(staleCandidate({ lastContact: yesterday }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(0);
    expect(sheets.tabs['Active'][0].inviteCount).toBe('1');
  });

  it('defaults inviteCount to 1 when field is missing', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: undefined }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(1);
    expect(indeed.interviewsSetUp[0].options.message).toContain('following up');
    expect(sheets.tabs['Active'][0].inviteCount).toBe('2');
  });

  it('uses interview_follow_up_1 message for first follow-up', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '1', name: 'Jane Doe' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp[0].options.message).toBe('Hi Jane, following up!');
  });

  it('uses interview_follow_up_2 message for second follow-up', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '2', name: 'Jane Doe' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp[0].options.message).toBe('Hi Jane, last follow-up!');
  });

  it('logs error and continues when setupInterview throws for one candidate', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    sheets.tabs['Active'].push(staleCandidate({ name: 'Jane Doe', indeedId: 'bad-id', inviteCount: '1' }));
    sheets.tabs['Active'].push(makeCandidate({
      name: 'Bob Jones', indeedId: 'good-id',
      status: 'Screened - Invite Sent', inviteCount: '1', lastContact: fourDaysAgo,
    }));

    let callCount = 0;
    indeed.setupInterview = async (id) => {
      callCount++;
      if (id === 'bad-id') throw new Error('Indeed API error');
    };

    await agent.processFollowUps();

    expect(callCount).toBe(2);
    expect(sheets.tabs['Active'][1].inviteCount).toBe('2');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test tests/pipeline.test.ts
```

Expected: FAIL — `processFollowUps` is not defined on Agent.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/pipeline.test.ts
git commit -m "test(agent): add failing tests for processFollowUps"
```

---

## Task 5: Implement processFollowUps in agent.ts + set inviteCount on first invite

**Files:**
- Modify: `src/agent.ts`

- [ ] **Step 1: Set inviteCount='1' when first invite is sent**

In `processPendingDecisions`, find the `updateCandidateStatus` call that sets `'Screened - Invite Sent'`:

```ts
await this.sheets.updateCandidateStatus(
  candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteSentAt: today() }
);
```

Change it to:

```ts
await this.sheets.updateCandidateStatus(
  candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteSentAt: today(), inviteCount: '1' }
);
```

- [ ] **Step 2: Add processFollowUps method to Agent**

Add this method to the `Agent` class, before the `run()` method:

```ts
async processFollowUps(): Promise<{ followUpsSent: { name: string; inviteCount: number }[]; neverResponded: string[] }> {
  console.log('\n[Agent] Checking for candidates needing follow-up...');
  const candidates = await this.sheets.getActiveCandidates();
  const pending = candidates.filter(c => c.status === 'Screened - Invite Sent');
  console.log(`[Agent] ${pending.length} candidate(s) at Screened - Invite Sent.`);

  const followUpsSent: { name: string; inviteCount: number }[] = [];
  const neverResponded: string[] = [];
  const thresholdDays = this.config.scheduling.follow_up_days;

  for (const candidate of pending) {
    try {
      if (!candidate.lastContact) {
        console.warn(`[Agent] ${candidate.name} — no lastContact date, skipping.`);
        continue;
      }

      const daysSince = Math.floor(
        (Date.now() - new Date(candidate.lastContact).getTime()) / 86_400_000
      );

      if (daysSince < thresholdDays) {
        console.log(`[Agent] ${candidate.name} — last contact ${daysSince} day(s) ago, threshold is ${thresholdDays} — skipping.`);
        continue;
      }

      const inviteCount = parseInt(candidate.inviteCount ?? '1', 10) || 1;
      const firstName = candidate.name.includes(',')
        ? candidate.name.split(',')[1]?.trim() ?? candidate.name
        : candidate.name.split(' ')[0] ?? candidate.name;
      const folderId = candidate.driveFolder?.match(/folders\/([^/?]+)/)?.[1];

      if (inviteCount >= 3) {
        console.log(`[Agent] ${candidate.name} — inviteCount=${inviteCount} — no response after 3 invites, moving to Never Responded.`);
        if (folderId) {
          console.log(`[Agent] Moving Drive folder to Never Responded...`);
          await this.drive.moveFolder(folderId, this.config.google_drive.never_responded_folder_id);
        }
        console.log(`[Agent] Moving row to Never Responded tab...`);
        await this.sheets.moveCandidate(candidate.name, 'Active', 'Never Responded');
        neverResponded.push(candidate.name);
        continue;
      }

      const messageTemplate = inviteCount === 1
        ? this.config.messages.interview_follow_up_1
        : this.config.messages.interview_follow_up_2;
      const nextCount = inviteCount + 1;

      console.log(`[Agent] ${candidate.name} — last contact ${daysSince} day(s) ago, inviteCount=${inviteCount} — sending follow-up ${inviteCount}.`);
      await this.indeed.setupInterview(candidate.indeedId, {
        message: renderTemplate(messageTemplate, { FIRST_NAME: firstName }),
        hiringTeamEmails: this.config.scheduling.hiring_team_emails,
      });

      await this.sheets.updateCandidateStatus(
        candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteCount: String(nextCount) }
      );

      followUpsSent.push({ name: candidate.name, inviteCount: nextCount });
      console.log(`[Agent] Follow-up ${inviteCount} sent to ${candidate.name} (inviteCount now ${nextCount}).`);

    } catch (err) {
      console.error(`[Agent] Error processing follow-up for ${candidate.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { followUpsSent, neverResponded };
}
```

- [ ] **Step 3: Run tests**

```bash
npm test tests/pipeline.test.ts
```

Expected: all processFollowUps tests pass.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts
git commit -m "feat(agent): add processFollowUps — send follow-up invites, move to Never Responded after 3"
```

---

## Task 6: Update logger.ts and RunResult, wire up run-act.ts

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/run-act.ts`

- [ ] **Step 1: Add followUpsSent and neverResponded to evaluateCandidates RunResult initializer**

In `src/agent.ts`, find the `RunResult` initialization in `evaluateCandidates` and add the two new arrays:

```ts
const result: RunResult = {
  startedAt, completedAt: startedAt, durationMs: 0,
  newApplicantsReviewed: 0, remainingApplicants: 0,
  passed: [], rejected: [], unsure: [],
  bookings: [], coldCandidates: [], errors: [],
  pdfFailures: [], scoreFailures: [],
  followUpsSent: [], neverResponded: [],
  configVersion: getGitCommitHash(),
  screeningCriteria: {
    required: this.config.screening.required,
    preferred: this.config.screening.preferred,
  },
};
```

- [ ] **Step 2: Add follow-up sections to formatRunLog in logger.ts**

In `src/logger.ts`, find the `SCORE FAILURES` block:

```ts
  if (result.scoreFailures.length > 0) {
    lines.push('', `SCORE FAILURES (${result.scoreFailures.length})`);
    for (const name of result.scoreFailures) {
      lines.push(`  ✗ ${name} — scoring failed, fallback score of 0 used`);
    }
  }
```

After it, add:

```ts
  if (result.followUpsSent.length > 0) {
    lines.push('', `FOLLOW-UPS SENT (${result.followUpsSent.length})`);
    for (const f of result.followUpsSent) {
      lines.push(`  → ${f.name} — invite #${f.inviteCount}`);
    }
  }

  if (result.neverResponded.length > 0) {
    lines.push('', `NEVER RESPONDED (${result.neverResponded.length})`);
    for (const name of result.neverResponded) {
      lines.push(`  → ${name} — moved after 3 unanswered invites`);
    }
  }
```

- [ ] **Step 3: Wire up processFollowUps in run-act.ts**

In `src/run-act.ts`, update the try block:

```ts
try {
  await agent.processPendingDecisions();
  await agent.processBookedInterviews();
  const { followUpsSent, neverResponded } = await agent.processFollowUps();
  clearTimeout(timeout);
  if (followUpsSent.length > 0) {
    console.log(`[Act] Follow-ups sent: ${followUpsSent.map(f => f.name).join(', ')}`);
  }
  if (neverResponded.length > 0) {
    console.log(`[Act] Moved to Never Responded: ${neverResponded.join(', ')}`);
  }
  console.log('\n[Act] Complete.');
} catch (err) {
  clearTimeout(timeout);
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  throw err;
} finally {
  await indeed.close();
  stopLog();
}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts src/logger.ts src/run-act.ts
git commit -m "feat: wire processFollowUps into run-act, add follow-up sections to run log"
```

---

## Task 7: Update migration script and sheet headers

**Files:**
- Modify: `src/scripts/add-score-columns.ts`

- [ ] **Step 1: Update EXPECTED_HEADERS and TABS**

In `src/scripts/add-score-columns.ts`, update `EXPECTED_HEADERS` to add `'Invite Count'` at the end, and add `'Never Responded'` to `TABS`:

```ts
// Full expected header row A–X (must stay in sync with COLUMNS in sheets.ts)
const EXPECTED_HEADERS = [
  'Name', 'Phone', 'Email', 'Indeed URL', 'Indeed ID', 'Location',
  'Experience', 'Certifications', 'Agent Recommendation', 'Status',
  'Last Contact', 'Drive Folder', 'Human Decision', 'Notes',
  'Score', 'Score Recommendation', 'Score Tier', 'Key Strengths', 'Concerns', 'Interview Questions',
  'Processed At', 'Invite Sent At', 'Interview Scheduled At', 'Invite Count',
];

const TABS = ['Active', 'Rejected', 'Checkback Later', 'Never Responded'];
```

Also update the range string inside the loop from `A1:W1` to `A1:X1`:

```ts
const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${tab}!A1:X1`,
});
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/add-score-columns.ts
git commit -m "feat(migration): add Invite Count header and Never Responded tab to sync script"
```

---

## Setup Before First Run

Before running `npm run act` with this feature active:

1. **Create the "Never Responded" folder in Google Drive** and copy its ID into `config.yaml` under `google_drive.never_responded_folder_id`.

2. **Create the "Never Responded" tab in the Google Sheet** (add it manually in the spreadsheet).

3. **Run the header sync script** to add the `Invite Count` column header (X) to all tabs:
   ```bash
   npm run add-score-columns
   ```