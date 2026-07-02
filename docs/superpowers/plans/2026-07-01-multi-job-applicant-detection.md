# Multi-Job Applicant Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect candidates who applied to more than one job on the Indeed account, flag them for human review with a Slack alert, skip all automated processing until a human resolves them, and also check before sending follow-up invites.

**Architecture:** The `IndeedAdapter` interface gains a renamed method `fetchProfileData` that returns both profile text and an `otherJobCount` parsed from the `[data-testid="note-section"]` activity feed. `evaluateCandidates` branches on this count: multi-job candidates get a minimal row with `status = 'Human Review'` and a Slack alert, bypassing Drive, screening, and scoring. `processFollowUps` calls `fetchProfileData` before each follow-up invite; if the candidate has since applied to other jobs, it flags them instead of sending.

**Tech Stack:** TypeScript ESM, Playwright (IndeedService), Vitest (tests)

## Global Constraints

- All imports use `.js` extension (ESM project)
- `CandidateStatus` union lives in `src/types.ts` — add `'Human Review'` there
- `RunResult` lives in `src/types.ts` — add `humanReviewFlagged: string[]` there
- `IndeedAdapter` interface lives in `src/types.ts` — rename `fetchProfileText` to `fetchProfileData`
- Test command: `npm test` (runs `vitest run`)
- No new dependencies

---

### Task 1: Update types, fakes, and IndeedService

Rename `fetchProfileText` → `fetchProfileData` across the interface, fake, and real adapter. Add `'Human Review'` to `CandidateStatus`. Add `humanReviewFlagged` to `RunResult`. No new agent behavior yet — existing tests must still pass.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/fakes/indeed.fake.ts`
- Modify: `src/adapters/indeed.ts`
- Test: `tests/pipeline.test.ts` (regression run; no new test cases in this task)

**Interfaces:**
- Produces: `IndeedAdapter.fetchProfileData(profileUrl: string): Promise<{ text: string; otherJobCount: number }>`
- Produces: `CandidateStatus` includes `'Human Review'`
- Produces: `RunResult.humanReviewFlagged: string[]`
- Produces: `FakeIndeedAdapter.multiJobApplicantIds: Set<string>` (seeding mechanism for tests)

- [ ] **Step 1: Update `src/types.ts`**

  In `CandidateStatus`, add `'Human Review'`:

  ```ts
  export type CandidateStatus =
    | 'Awaiting Review'
    | 'Screened - Invite Sent'
    | 'Interview Scheduled'
    | 'Cold'
    | 'UNSURE'
    | 'Rejected'
    | 'Never Responded'
    | 'Onboarding'
    | 'Human Review';
  ```

  In `RunResult`, add the new field after `neverResponded`:

  ```ts
  neverResponded: string[];
  humanReviewFlagged: string[];
  ```

  In `IndeedAdapter`, rename the method:

  ```ts
  // was: fetchProfileText(profileUrl: string): Promise<string>;
  fetchProfileData(profileUrl: string): Promise<{ text: string; otherJobCount: number }>;
  ```

- [ ] **Step 2: Update `src/fakes/indeed.fake.ts`**

  Add the `multiJobApplicantIds` set and rename the method:

  ```ts
  import type { IndeedAdapter, Applicant, Interview } from '../types.js';

  export class FakeIndeedAdapter implements IndeedAdapter {
    private applicants: Applicant[] = [];
    private interviews: Interview[] = [];
    markedSentiments: { applicantId: string; sentiment: string }[] = [];
    interviewsSetUp: { applicantId: string; options: { message: string; hiringTeamEmails: string[] } }[] = [];
    statusesSet: { applicantId: string; status: string }[] = [];
    multiJobApplicantIds: Set<string> = new Set();

    seedApplicants(applicants: Applicant[]): void {
      this.applicants = applicants;
    }

    seedInterviews(interviews: Interview[]): void {
      this.interviews = interviews;
    }

    async getNewApplications(_since: Date): Promise<Applicant[]> {
      return [...this.applicants];
    }

    async fetchProfileData(profileUrl: string): Promise<{ text: string; otherJobCount: number }> {
      const idMatch = profileUrl.match(/[?&]id=([^&]+)/);
      const id = idMatch?.[1] ?? '';
      const otherJobCount = this.multiJobApplicantIds.has(id) ? 1 : 0;
      return { text: 'Fake profile text', otherJobCount };
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

- [ ] **Step 3: Update `src/adapters/indeed.ts`**

  Rename `fetchProfileText` to `fetchProfileData` and make it return `{ text, otherJobCount }`. The existing private `fetchProfileTextInternal` stays but is called from the new public method. After it returns, the page is still on the profile URL — read the note section without re-navigating.

  Replace the existing `fetchProfileText` public method (lines ~127-129) with:

  ```ts
  async fetchProfileData(profileUrl: string): Promise<{ text: string; otherJobCount: number }> {
    const text = await this.fetchProfileTextInternal(profileUrl);

    const page = await this.getPage();
    let otherJobCount = 0;
    try {
      const noteSection = await page.$('[data-testid="note-section"]');
      if (noteSection) {
        const noteText = (await noteSection.textContent()) ?? '';
        const match = noteText.match(/This candidate has applied to (\d+) other job/i);
        if (match) {
          otherJobCount = parseInt(match[1], 10);
        }
      }
    } catch {
      // note section absent or unreadable — treat as no other jobs
    }

    return { text, otherJobCount };
  }
  ```

- [ ] **Step 4: Fix the TypeScript compile error in `src/agent.ts`**

  The agent currently calls `this.indeed.fetchProfileText(...)`. Update that one call to use the new signature:

  Find the line (around line 71):
  ```ts
  applicant.resumeText = await this.indeed.fetchProfileText(applicant.indeedProfileUrl);
  ```

  Replace with:
  ```ts
  const { text: profileText } = await this.indeed.fetchProfileData(applicant.indeedProfileUrl);
  applicant.resumeText = profileText;
  ```

  Also initialize `humanReviewFlagged` in the `RunResult` object (around line 38, after `neverResponded: []`):
  ```ts
  neverResponded: [],
  humanReviewFlagged: [],
  ```

- [ ] **Step 5: Run tests to verify no regressions**

  ```bash
  npm test
  ```

  Expected: all existing tests pass (same count as before this task).

- [ ] **Step 6: Commit**

  ```bash
  git add src/types.ts src/fakes/indeed.fake.ts src/adapters/indeed.ts src/agent.ts
  git commit -m "feat: rename fetchProfileText→fetchProfileData, add Human Review status and humanReviewFlagged"
  ```

---

### Task 2: Multi-job detection in `evaluateCandidates` and `processFollowUps`

Use `otherJobCount` from `fetchProfileData` in `evaluateCandidates` to branch multi-job candidates to a Human Review row. Also check `fetchProfileData` in `processFollowUps` before each follow-up invite.

**Files:**
- Modify: `src/agent.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `IndeedAdapter.fetchProfileData(profileUrl): Promise<{ text: string; otherJobCount: number }>` (Task 1)
- Consumes: `CandidateStatus` includes `'Human Review'` (Task 1)
- Consumes: `RunResult.humanReviewFlagged: string[]` (Task 1)
- Consumes: `FakeIndeedAdapter.multiJobApplicantIds: Set<string>` (Task 1)

- [ ] **Step 1: Write the failing tests**

  In `tests/pipeline.test.ts`, add a new `describe` block. Place it after the existing `describe('processFollowUps', ...)` block:

  ```ts
  describe('multi-job applicant detection', () => {
    it('adds Human Review row, posts Slack, populates humanReviewFlagged, skips Drive/scoring', async () => {
      const applicant = makeApplicant({
        id: 'app-multi',
        name: 'Multi Job',
        firstName: 'Multi',
        lastName: 'Job',
        indeedProfileUrl: 'https://employers.indeed.com/candidates/view?id=app-multi',
      });
      indeed.seedApplicants([applicant]);
      indeed.multiJobApplicantIds.add('app-multi');

      const result = await agent.evaluateCandidates(new Date(0));

      const row = sheets.tabs['Active'].find(c => c.name === 'Multi Job');
      expect(row).toBeDefined();
      expect(row!.status).toBe('Human Review');
      expect(row!.notes).toBe('Applied to 1 other job(s) on this account — human review required');
      expect(row!.indeedId).toBe('app-multi');
      expect(row!.humanDecision).toBe('');

      expect(drive.folders).toHaveLength(0);
      expect(drive.files).toHaveLength(0);
      expect(drive.copies).toHaveLength(0);
      expect(indeed.markedSentiments).toHaveLength(0);

      expect(slack.messages).toHaveLength(1);
      expect(slack.messages[0].message).toContain('Multi Job');
      expect(slack.messages[0].message).toContain('1 other job(s)');
      expect(slack.messages[0].message).toContain('Human review needed');

      expect(result.humanReviewFlagged).toEqual(['Multi Job']);
    });

    it('normal candidate (otherJobCount=0) still goes through full pipeline', async () => {
      indeed.seedApplicants([makeApplicant()]);

      const result = await agent.evaluateCandidates(new Date(0));

      expect(result.humanReviewFlagged).toHaveLength(0);
      expect(drive.folders).toHaveLength(1);
    });

    it('processFollowUps flags Human Review candidate instead of sending follow-up', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        name: 'Follow Up Person',
        indeedId: 'app-fu',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-fu',
        status: 'Screened - Invite Sent',
        lastContact: '2026-01-01',
        inviteCount: '1',
      }));
      indeed.multiJobApplicantIds.add('app-fu');

      const { followUpsSent } = await agent.processFollowUps();

      expect(followUpsSent).toHaveLength(0);
      expect(indeed.interviewsSetUp).toHaveLength(0);

      const row = sheets.tabs['Active'].find(c => c.name === 'Follow Up Person');
      expect(row!.status).toBe('Human Review');

      expect(slack.messages).toHaveLength(1);
      expect(slack.messages[0].message).toContain('Follow Up Person');
      expect(slack.messages[0].message).toContain('Human review needed');
    });

    it('processFollowUps still sends follow-up when candidate has not applied to other jobs', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        name: 'Normal Follow Up',
        indeedId: 'app-normal',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-normal',
        status: 'Screened - Invite Sent',
        lastContact: '2026-01-01',
        inviteCount: '1',
      }));
      // multiJobApplicantIds is empty — otherJobCount will be 0

      const { followUpsSent } = await agent.processFollowUps();

      expect(followUpsSent).toHaveLength(1);
      expect(indeed.interviewsSetUp).toHaveLength(1);
    });

    it('processPendingDecisions acts normally on Human Review candidate when humanDecision is set', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        name: 'Doe, John',
        indeedId: 'app-hr',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-hr',
        status: 'Human Review',
        humanDecision: 'Reject',
        driveFolder: '',
      }));

      await agent.processPendingDecisions();

      const rejectedRow = sheets.tabs['Rejected'].find(c => c.name === 'Doe, John');
      expect(rejectedRow).toBeDefined();
      expect(sheets.tabs['Active'].find(c => c.name === 'Doe, John')).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  npm test
  ```

  Expected: the 5 new tests fail (property/method doesn't exist or behavior wrong). All pre-existing tests still pass.

- [ ] **Step 3: Implement the multi-job branch in `evaluateCandidates`**

  In `src/agent.ts`, in `evaluateCandidates`, find the try block that starts with (around line 69):

  ```ts
  console.log(`[Agent] Fetching profile text for ${applicant.name}...`);
  try {
    applicant.resumeText = await this.indeed.fetchProfileText(applicant.indeedProfileUrl);
  ```

  After Task 1, that section already looks like:

  ```ts
  console.log(`[Agent] Fetching profile text for ${applicant.name}...`);
  try {
    const { text: profileText } = await this.indeed.fetchProfileData(applicant.indeedProfileUrl);
    applicant.resumeText = profileText;
    console.log(`[Agent] Profile text fetched (${applicant.resumeText.length} chars).`);
  } catch (profileErr) {
    console.log(`[Agent] Could not fetch profile text: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
  }
  ```

  Replace that entire try/catch block with:

  ```ts
  console.log(`[Agent] Fetching profile data for ${applicant.name}...`);
  let profileFetchResult: { text: string; otherJobCount: number } = { text: '', otherJobCount: 0 };
  try {
    profileFetchResult = await this.indeed.fetchProfileData(applicant.indeedProfileUrl);
    applicant.resumeText = profileFetchResult.text;
    console.log(`[Agent] Profile text fetched (${applicant.resumeText.length} chars), otherJobCount=${profileFetchResult.otherJobCount}.`);
  } catch (profileErr) {
    console.log(`[Agent] Could not fetch profile data: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
  }

  if (profileFetchResult.otherJobCount > 0) {
    console.log(`[Agent] ${applicant.name} has applied to ${profileFetchResult.otherJobCount} other job(s) — flagging for human review.`);
    const row: CandidateRow = {
      name: applicant.name,
      phone: applicant.phone ?? '',
      email: applicant.email ?? '',
      indeedUrl: applicant.indeedProfileUrl,
      indeedId: applicant.id,
      location: applicant.location ?? '',
      experience: '',
      certifications: '',
      agentRecommendation: '',
      status: 'Human Review',
      lastContact: today(),
      driveFolder: '',
      humanDecision: '',
      notes: `Applied to ${profileFetchResult.otherJobCount} other job(s) on this account — human review required`,
      processedAt: today(),
    };
    await this.sheets.addCandidate('Active', row);
    await this.slack.post(
      this.config.slack.recruiting_channel,
      `⚠️ *Human review needed:* ${applicant.name} has applied to ${profileFetchResult.otherJobCount} other job(s) on this account. Please review and decide how to proceed.\n<${applicant.indeedProfileUrl}|View in Indeed>`
    );
    result.humanReviewFlagged.push(applicant.name);
    markProcessed(applicant.id);
    continue;
  }
  ```

  Also add `import type { ..., CandidateRow }` to the import at the top if `CandidateRow` isn't already imported. Check the first line of `src/agent.ts`:

  ```ts
  import type {
    IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
    Screener, Scorer, Config, RunResult, CandidateRow, CandidateStatus, OfferInfo,
  } from './types.js';
  ```

  `CandidateRow` is already imported — no change needed.

- [ ] **Step 4: Implement the multi-job check in `processFollowUps`**

  In `src/agent.ts`, in `processFollowUps`, find the per-candidate loop body (around line 421). After the `daysSince` check and before the `inviteCount >= 3` check, add the multi-job detection:

  Find this block:
  ```ts
  if (daysSince < thresholdDays) {
    console.log(`[Agent] ${candidate.name} — last contact ${daysSince} day(s) ago, threshold is ${thresholdDays} — skipping.`);
    continue;
  }

  const inviteCount = parseInt(candidate.inviteCount ?? '1', 10) || 1;
  ```

  Insert between those two blocks:

  ```ts
  console.log(`[Agent] Checking for multi-job application for ${candidate.name}...`);
  try {
    const { otherJobCount } = await this.indeed.fetchProfileData(candidate.indeedUrl);
    if (otherJobCount > 0) {
      console.log(`[Agent] ${candidate.name} has applied to ${otherJobCount} other job(s) — flagging for human review instead of sending follow-up.`);
      await this.sheets.updateCandidateStatus(candidate.name, 'Human Review');
      await this.slack.post(
        this.config.slack.recruiting_channel,
        `⚠️ *Human review needed:* ${candidate.name} has applied to ${otherJobCount} other job(s) on this account. Please review and decide how to proceed.\n<${candidate.indeedUrl}|View in Indeed>`
      );
      continue;
    }
  } catch (profileErr) {
    console.log(`[Agent] Could not check multi-job status for ${candidate.name}: ${profileErr instanceof Error ? profileErr.message : profileErr} — proceeding with follow-up.`);
  }

  const inviteCount = parseInt(candidate.inviteCount ?? '1', 10) || 1;
  ```

- [ ] **Step 5: Run tests to verify they all pass**

  ```bash
  npm test
  ```

  Expected: all tests pass (pre-existing + 5 new).

- [ ] **Step 6: Commit**

  ```bash
  git add src/agent.ts tests/pipeline.test.ts
  git commit -m "feat: detect multi-job applicants, flag for human review, check before follow-up"
  ```
