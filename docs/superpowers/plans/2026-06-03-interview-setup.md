# Interview Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `sendMessage` + `triggerScheduler` approve flow with a real `setupInterview` method that fills out Indeed's schedule interview modal; remove standalone rejection messages (Indeed sends an automated follow-up after sentiment is marked "no").

**Architecture:** `triggerScheduler` and `sendMessage` are removed from `IndeedAdapter` and replaced by `setupInterview`. The agent's approve flow calls `setupInterview` (which includes the message); the reject flow drops `sendMessage` entirely. Config renames `messages.intro` → `messages.interview_request` with `{FIRST_NAME}` / `{LAST_NAME}` tokens, and drops `messages.rejection`.

**Tech Stack:** TypeScript ESM, Vitest, Playwright, `renderTemplate` (already handles `{TOKEN}` syntax).

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Remove `sendMessage`, `triggerScheduler` from `IndeedAdapter`; add `setupInterview`; rename `messages.intro` → `messages.interview_request` in `Config`; remove `messages.rejection` |
| `src/fakes/indeed.fake.ts` | Remove `sentMessages`, `triggeredSchedulers`, `sendMessage`, `triggerScheduler`; add `interviewsSetUp` array and `setupInterview` method |
| `src/adapters/indeed.ts` | Remove `sendMessage`, `triggerScheduler`; add `setupInterview` with full Playwright flow |
| `src/agent.ts` | Approve: remove `sendMessage` + `triggerScheduler`, add `setupInterview` with rendered message and extracted lastName; Reject: remove `sendMessage` |
| `tests/pipeline.test.ts` | Update test config fixture; update Approve test (check `interviewsSetUp`, remove `sentMessages`/`triggeredSchedulers` assertions); update Reject test (remove `sentMessages` assertion) |
| `config.yaml` | Rename `messages.intro` → `messages.interview_request`; update `{name}` → `{FIRST_NAME}`; remove `messages.rejection` |
| `config.yaml.example` | Same renames as `config.yaml` |

---

### Task 1: Update `IndeedAdapter` interface and `Config` type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Remove `sendMessage` and `triggerScheduler`; add `setupInterview` to `IndeedAdapter`**

Find the `IndeedAdapter` interface and replace it with:

```typescript
export interface IndeedAdapter {
  getNewApplications(since: Date): Promise<Applicant[]>;
  fetchProfileText(profileUrl: string): Promise<string>;
  markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void>;
  setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void>;
  getBookedInterviews(): Promise<Interview[]>;
  downloadResume(applicantId: string): Promise<Buffer>;
}
```

- [ ] **Step 2: Rename `messages.intro` → `messages.interview_request`; remove `messages.rejection` in `Config`**

Find the `messages` block in the `Config` interface and replace it with:

```typescript
messages: {
  interview_request: string;
};
```

- [ ] **Step 3: Run tests to see what breaks**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | head -60
```

Expected: TypeScript compile errors in `src/fakes/indeed.fake.ts`, `src/agent.ts`, and `tests/pipeline.test.ts` — the interface no longer has `sendMessage`, `triggerScheduler`, or `messages.intro`/`messages.rejection`. This is expected.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/types.ts
git commit -m "feat(types): replace sendMessage+triggerScheduler with setupInterview; rename messages.intro to interview_request"
```

---

### Task 2: Update `FakeIndeedAdapter` and tests

**Files:**
- Modify: `src/fakes/indeed.fake.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Update `tests/pipeline.test.ts` config fixture**

Find the `config` constant near the top of the test file. Update `messages` and remove `rejection`:

```typescript
messages: {
  interview_request: 'Hi {FIRST_NAME}, thanks for applying!',
},
```

- [ ] **Step 2: Replace the Approve test**

Find `it('Approve: clears humanDecision first, marks yes sentiment, sends intro, triggers scheduler, moves folder, updates status', ...)` and replace it entirely:

```typescript
it('Approve: clears humanDecision first, marks yes sentiment, sets up interview, moves folder, updates status', async () => {
  sheets.tabs['Active'].push(makeCandidate({
    indeedId: 'app-1', humanDecision: 'Approve',
    driveFolder: 'https://drive.google.com/drive/folders/folder-1',
  }));

  await agent.processPendingDecisions();

  expect(indeed.markedSentiments[0]).toEqual({ applicantId: 'app-1', sentiment: 'yes' });
  expect(indeed.interviewsSetUp).toHaveLength(1);
  expect(indeed.interviewsSetUp[0].applicantId).toBe('app-1');
  expect(indeed.interviewsSetUp[0].options.message).toContain('Jane');
  expect(indeed.interviewsSetUp[0].options.hiringTeamEmails).toEqual([]);
  expect(drive.moves[0].folderId).toBe('folder-1');
  expect(drive.moves[0].targetParentId).toBe('root-id');
  expect(sheets.tabs['Active'][0].status).toBe('Screened - Invite Sent');
  expect(sheets.tabs['Active'][0].humanDecision).toBe('');
  expect(sheets.tabs['Active'][0].lastContact).toBeTruthy();
});
```

- [ ] **Step 3: Replace the Reject test**

Find `it('Reject: clears humanDecision first, marks no sentiment, sends rejection, moves folder and row', ...)` and replace it entirely:

```typescript
it('Reject: clears humanDecision first, marks no sentiment, moves folder and row (no message sent)', async () => {
  sheets.tabs['Active'].push(makeCandidate({
    indeedId: 'app-1', humanDecision: 'Reject',
    driveFolder: 'https://drive.google.com/drive/folders/folder-1',
  }));

  await agent.processPendingDecisions();

  expect(indeed.markedSentiments[0]).toEqual({ applicantId: 'app-1', sentiment: 'no' });
  expect(indeed.interviewsSetUp).toHaveLength(0);
  expect(drive.moves[0].targetParentId).toBe('rejected-id');
  expect(sheets.tabs['Active']).toHaveLength(0);
  expect(sheets.tabs['Rejected']).toHaveLength(1);
});
```

- [ ] **Step 4: Run to confirm tests fail**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -20
```

Expected: compile errors about missing `interviewsSetUp`, `sentMessages`, `triggeredSchedulers`.

- [ ] **Step 5: Rewrite `src/fakes/indeed.fake.ts`**

```typescript
import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class FakeIndeedAdapter implements IndeedAdapter {
  private applicants: Applicant[] = [];
  private interviews: Interview[] = [];
  markedSentiments: { applicantId: string; sentiment: string }[] = [];
  interviewsSetUp: { applicantId: string; options: { message: string; hiringTeamEmails: string[] } }[] = [];

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
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: compile errors now only in `src/agent.ts` (still references `sendMessage`, `triggerScheduler`, `messages.intro`, `messages.rejection`). The fake itself compiles. Test failures about `sentMessages`/`triggeredSchedulers` should be gone.

- [ ] **Step 7: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/fakes/indeed.fake.ts tests/pipeline.test.ts
git commit -m "feat(fakes): replace sendMessage/triggerScheduler with setupInterview in FakeIndeedAdapter; update tests"
```

---

### Task 3: Update `agent.ts` approve and reject flows

**Files:**
- Modify: `src/agent.ts`

- [ ] **Step 1: Extract `lastName` alongside `firstName` in `processPendingDecisions`**

Find the `firstName` extraction block (around line 154) and add `lastName`:

```typescript
const firstName = candidate.name.includes(',')
  ? candidate.name.split(',')[1]?.trim() ?? candidate.name
  : candidate.name.split(' ')[0] ?? candidate.name;
const lastName = candidate.name.includes(',')
  ? candidate.name.split(',')[0]?.trim() ?? ''
  : candidate.name.split(' ').slice(1).join(' ');
```

- [ ] **Step 2: Replace the entire Approve branch**

Find the `if (decision === 'approve') { ... }` block and replace it:

```typescript
if (decision === 'approve') {
  console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
  await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

  console.log(`[Agent] Marking sentiment "yes" on Indeed...`);
  await this.indeed.markSentiment(candidate.indeedId, 'yes');

  console.log(`[Agent] Setting up interview for ${candidate.name}...`);
  await this.indeed.setupInterview(candidate.indeedId, {
    message: renderTemplate(this.config.messages.interview_request, {
      FIRST_NAME: firstName,
      LAST_NAME: lastName,
    }),
    hiringTeamEmails: this.config.scheduling.hiring_team_emails,
  });

  if (folderId) {
    console.log(`[Agent] Moving Drive folder to recruiting root...`);
    await this.drive.moveFolder(folderId, this.config.google_drive.recruiting_root_folder_id);
  }

  await this.sheets.updateCandidateStatus(
    candidate.name, 'Screened - Invite Sent', { lastContact: today() }
  );
```

- [ ] **Step 3: Replace the Reject branch**

Find `} else if (decision === 'reject') { ... }` and replace it:

```typescript
} else if (decision === 'reject') {
  console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
  await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

  console.log(`[Agent] Marking sentiment "no" on Indeed (automated follow-up sends in 3 days)...`);
  await this.indeed.markSentiment(candidate.indeedId, 'no');

  if (folderId) {
    console.log(`[Agent] Moving Drive folder to _Rejected...`);
    await this.drive.moveFolder(folderId, this.config.google_drive.rejected_folder_id);
  }

  console.log(`[Agent] Moving row to Rejected tab...`);
  await this.sheets.moveCandidate(candidate.name, 'Active', 'Rejected');
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/agent.ts
git commit -m "feat(agent): approve calls setupInterview; reject drops sendMessage"
```

---

### Task 4: Implement `setupInterview` in `IndeedService`

**Files:**
- Modify: `src/adapters/indeed.ts`

- [ ] **Step 1: Remove `sendMessage` and `triggerScheduler` methods**

Delete both methods entirely from `IndeedService`. They are no longer in the interface.

- [ ] **Step 2: Add `setupInterview` method**

Add after `markSentiment`:

```typescript
async setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void> {
  const page = await this.getPage();
  console.log(`[Indeed] Setting up interview for applicant ${applicantId}...`);

  await jitter(500, 1200);
  await page.goto(`https://employers.indeed.com/candidates/view?id=${applicantId}`);
  await page.waitForSelector('[data-testid="prioritized-schedule-interview-button"]', { timeout: 30_000 });
  await jitter(600, 1200);

  console.log('[Indeed] Clicking Setup Interview button...');
  await page.click('[data-testid="prioritized-schedule-interview-button"]');
  await page.waitForSelector('[data-testid="ScheduleInterviewModal-SendInterviewButton"]', { timeout: 30_000 });
  await jitter(600, 1200);

  console.log('[Indeed] Setting duration...');
  await page.click('[data-testid="InterviewTimesSelector-duration"]');
  await jitter(300, 600);
  await page.click('[data-testid="InterviewTimesSelector-duration-30"]');
  await jitter(400, 800);

  console.log('[Indeed] Setting format to phone...');
  await page.click('[data-testid="gt-interview-details-interview-type"]');
  await jitter(400, 800);

  console.log('[Indeed] Filling message...');
  await page.click('[data-testid="gt-interview-form-message-to-candidate-text-area"]');
  await jitter(300, 700);
  await page.fill('[data-testid="gt-interview-form-message-to-candidate-text-area"]', '');
  await page.type('[data-testid="gt-interview-form-message-to-candidate-text-area"]', options.message, { delay: 40 + Math.random() * 60 });
  await jitter(400, 900);

  console.log('[Indeed] Enabling hiring team switch...');
  await page.click('[data-testid="gt-interview-details-hiring-team-switch"]');
  await jitter(400, 800);

  if (options.hiringTeamEmails.length > 0) {
    console.log('[Indeed] Filling hiring team emails...');
    await page.click('[data-testid="gt-interview-details-interviewer-list"]');
    await jitter(300, 600);
    await page.type('[data-testid="gt-interview-details-interviewer-list"]', options.hiringTeamEmails.join(', '), { delay: 40 + Math.random() * 60 });
    await jitter(400, 800);
  }

  console.log('[Indeed] Selecting availability-based scheduling...');
  await page.click('[data-value="availabilityBasedScheduling"]');
  await jitter(400, 800);

  console.log('[Indeed] Sending interview request...');
  await page.click('[data-testid="ScheduleInterviewModal-SendInterviewButton"]');
  await page.waitForSelector('[data-testid="ScheduleInterviewModal-SendInterviewButton"]', { state: 'detached', timeout: 30_000 });
  console.log('[Indeed] Interview request sent successfully.');
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/adapters/indeed.ts
git commit -m "feat(indeed): implement setupInterview; remove sendMessage and triggerScheduler"
```

---

### Task 5: Update `config.yaml` and `config.yaml.example`

**Files:**
- Modify: `config.yaml`
- Modify: `config.yaml.example`

- [ ] **Step 1: Update `config.yaml`**

Replace the `messages` block:

```yaml
messages:
  interview_request: "Hi {FIRST_NAME}, thank you for applying to FirstLight Home Care of South Jordan! We'd love to set up a quick phone call so that we can tell you more about us and the position as well as learn more about your background. Please use the link below to schedule a time that works for you."
```

- [ ] **Step 2: Update `config.yaml.example`**

Replace the `messages` block:

```yaml
messages:
  interview_request: "Hi {FIRST_NAME}, thank you for applying to Firstlight Home Care! We'd love to set up a quick phone call. Please use the link below to schedule a time that works for you."
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add config.yaml config.yaml.example
git commit -m "feat(config): rename messages.intro to interview_request with FIRST_NAME token; remove rejection message"
```

---

## Self-Review

**Spec coverage:**
- ✅ `sendMessage` removed from interface, fake, real adapter, agent approve and reject flows
- ✅ `triggerScheduler` removed from interface, fake, real adapter, agent approve flow
- ✅ `setupInterview` added to interface, fake, real adapter, agent approve flow
- ✅ `messages.rejection` removed from Config and config.yaml
- ✅ `messages.intro` renamed to `messages.interview_request` everywhere
- ✅ `{FIRST_NAME}` and `{LAST_NAME}` tokens supported (via existing `renderTemplate` — no code change needed)
- ✅ `lastName` extracted in agent alongside `firstName`
- ✅ Reject flow: no message sent, only sentiment "no" + folder/row move
- ✅ All 10 modal steps implemented in `setupInterview` with jitter

**Placeholder scan:** None found.

**Type consistency:**
- `setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] })` — consistent across Task 1 (types), Task 2 (fake), Task 3 (agent call site), Task 4 (implementation)
- `interviewsSetUp[0].options.message` / `interviewsSetUp[0].options.hiringTeamEmails` — consistent between Task 2 fake and Task 2 test assertions
- `this.config.messages.interview_request` in Task 3 matches Task 1 Config type and Task 5 config.yaml key
