# Booked Interview Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when candidates have booked an interview on Indeed and update their Sheets status to `Interview Scheduled`, stamp `lastContact`, and post a Slack alert — wired into `npm run act`.

**Architecture:** `getBookedInterviews()` on `IndeedService` scrapes Indeed's upcoming interviews page with pagination and click-per-card details. `processBookedInterviews()` on `Agent` cross-references the results against the Active sheet by `indeedId` and acts on matches. Both are called sequentially in `run-act.ts`.

**Tech Stack:** TypeScript ESM, Playwright, Vitest, existing adapter/fake pattern.

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Update `Interview`: remove `indeedInterviewId`, change `scheduledAt: Date` → `scheduledAt: string` |
| `src/agent.ts` | Add `processBookedInterviews()` method |
| `src/adapters/indeed.ts` | Rewrite `getBookedInterviews()` with real selectors and pagination |
| `src/run-act.ts` | Call `agent.processBookedInterviews()` after `processPendingDecisions()` |
| `tests/pipeline.test.ts` | Add `Agent.processBookedInterviews` describe block with 4 tests |

No changes to `src/fakes/indeed.fake.ts` or `src/fakes/sheets.fake.ts` — both already support this feature.

---

### Task 1: Update `Interview` type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update the `Interview` interface**

Find the `Interview` interface and replace it:

```typescript
export interface Interview {
  applicantId: string;
  applicantName: string;
  scheduledAt: string;
}
```

(Removes `indeedInterviewId: string` and changes `scheduledAt: Date` → `scheduledAt: string`.)

- [ ] **Step 2: Run tests to confirm nothing breaks**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all 47 tests pass. No existing tests use `indeedInterviewId` or `scheduledAt`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/types.ts
git commit -m "feat(types): simplify Interview — remove indeedInterviewId, scheduledAt as string"
```

---

### Task 2: Add `processBookedInterviews` to `Agent` — TDD

**Files:**
- Modify: `src/agent.ts`
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Add the failing tests**

In `tests/pipeline.test.ts`, add a new `describe` block after the existing `Agent.processPendingDecisions` describe block (before the closing `});` of the outer `describe('Agent.run — Phase 1...')`):

```typescript
describe('Agent.processBookedInterviews', () => {
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
  });

  it('updates status, lastContact, and posts Slack when interview is booked', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', name: 'Jane Doe', status: 'Screened - Invite Sent',
    }));
    indeed.seedInterviews([{
      applicantId: 'app-1',
      applicantName: 'Jane Doe',
      scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
    }]);

    await agent.processBookedInterviews();

    expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
    expect(sheets.tabs['Active'][0].lastContact).toBeTruthy();
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Jane Doe');
    expect(slack.messages[0].message).toContain('Thursday, June 5, 2026');
  });

  it('skips candidate already at Interview Scheduled', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', name: 'Jane Doe', status: 'Interview Scheduled',
    }));
    indeed.seedInterviews([{
      applicantId: 'app-1',
      applicantName: 'Jane Doe',
      scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
    }]);

    await agent.processBookedInterviews();

    expect(slack.messages).toHaveLength(0);
    expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
  });

  it('skips interview with no matching candidate in Active', async () => {
    indeed.seedInterviews([{
      applicantId: 'unknown-id',
      applicantName: 'Unknown Person',
      scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
    }]);

    await agent.processBookedInterviews();

    expect(slack.messages).toHaveLength(0);
  });

  it('processes multiple booked interviews', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-1', name: 'Jane Doe', status: 'Screened - Invite Sent',
    }));
    sheets.tabs['Active'].push(makeCandidate({
      indeedId: 'app-2', name: 'John Smith', status: 'Screened - Invite Sent',
    }));
    indeed.seedInterviews([
      { applicantId: 'app-1', applicantName: 'Jane Doe', scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)' },
      { applicantId: 'app-2', applicantName: 'John Smith', scheduledAt: 'Friday, June 6, 2026 from 2:00 to 2:15 pm (MDT)' },
    ]);

    await agent.processBookedInterviews();

    expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
    expect(sheets.tabs['Active'][1].status).toBe('Interview Scheduled');
    expect(slack.messages).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -10
```

Expected: 4 new test failures — `agent.processBookedInterviews is not a function`.

- [ ] **Step 3: Implement `processBookedInterviews` in `src/agent.ts`**

Add this method to the `Agent` class, after `processPendingDecisions` and before `run`:

```typescript
async processBookedInterviews(): Promise<void> {
  console.log('\n[Agent] Checking for booked interviews...');
  const interviews = await this.indeed.getBookedInterviews();
  console.log(`[Agent] ${interviews.length} booked interview(s) found on Indeed.`);

  const activeCandidates = await this.sheets.getActiveCandidates();
  const byIndeedId = new Map(activeCandidates.map(c => [c.indeedId, c]));

  for (const interview of interviews) {
    const candidate = byIndeedId.get(interview.applicantId);
    if (!candidate) {
      console.log(`[Agent] No matching candidate for applicantId=${interview.applicantId} — skipping.`);
      continue;
    }
    if (candidate.status === 'Interview Scheduled') {
      console.log(`[Agent] ${candidate.name} already at Interview Scheduled — skipping.`);
      continue;
    }
    console.log(`[Agent] Interview booked: ${candidate.name} — ${interview.scheduledAt}`);
    await this.sheets.updateCandidateStatus(candidate.name, 'Interview Scheduled', { lastContact: today() });
    await this.slack.post(
      this.config.slack.recruiting_channel,
      `🗓 *Interview scheduled:* ${candidate.name} — ${interview.scheduledAt}`
    );
  }
}
```

Note: `today()` is already defined at the bottom of `src/agent.ts` — do not add it again.

- [ ] **Step 4: Run tests to confirm all pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all 51 tests pass (47 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(agent): add processBookedInterviews; update status, lastContact, post Slack"
```

---

### Task 3: Rewrite `getBookedInterviews()` in `IndeedService`

**Files:**
- Modify: `src/adapters/indeed.ts`

- [ ] **Step 1: Replace `getBookedInterviews()` with the real implementation**

Find the existing `getBookedInterviews()` method in `IndeedService` and replace it entirely:

```typescript
async getBookedInterviews(): Promise<Interview[]> {
  const page = await this.getPage();
  console.log('[Indeed] Fetching booked interviews...');
  await jitter(500, 1000);
  await page.goto('https://employers.indeed.com/interviews/upcoming');
  await page.waitForSelector('[data-testid="interviewList"]', { timeout: 30_000 });
  await jitter(600, 1200);

  const interviews: Interview[] = [];

  while (true) {
    const cards = await page.$$('[data-testid="InterviewCard-Wrapper"]');
    console.log(`[Indeed] Processing ${cards.length} interview card(s) on this page...`);

    for (const card of cards) {
      await card.$eval('[data-testid="interview-card-candidate"]', el => (el as HTMLElement).click());
      await page.waitForSelector('[data-testid="CandidateDetails-viewCandidateLink"]', { timeout: 15_000 });
      await jitter(400, 800);

      const href = await page.$eval(
        '[data-testid="CandidateDetails-viewCandidateLink"]',
        el => el.getAttribute('href') ?? ''
      );
      const applicantId = href.match(/[?&]id=([a-z0-9]+)/)?.[1] ?? '';

      const applicantName = await card.$eval(
        '[data-testid="interview-card-candidate"]',
        el => el.textContent?.trim() ?? ''
      );

      const scheduledAt = await page.$eval(
        '[data-testid="interviewDetails-datetime"]',
        el => el.textContent?.trim() ?? ''
      );

      if (applicantId) {
        interviews.push({ applicantId, applicantName, scheduledAt });
        console.log(`[Indeed] Interview found: ${applicantName} (${applicantId}) — ${scheduledAt}`);
      } else {
        console.log(`[Indeed] Could not extract applicantId from href "${href}" — skipping card.`);
      }

      await jitter(300, 700);
    }

    const paginationButtons = await page.$$('[data-testid="interviewList-ListPagination"] button');
    const nextButton = paginationButtons[1];
    if (!nextButton || await nextButton.isDisabled()) break;

    console.log('[Indeed] Moving to next page of interviews...');
    await nextButton.click();
    await page.waitForSelector('[data-testid="interviewList"]', { timeout: 15_000 });
    await jitter(600, 1200);
  }

  console.log(`[Indeed] ${interviews.length} booked interview(s) found total.`);
  return interviews;
}
```

- [ ] **Step 2: Run tests to confirm all still pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all 51 tests pass (the real `IndeedService` is not used in tests — `FakeIndeedAdapter` is).

- [ ] **Step 3: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/adapters/indeed.ts
git commit -m "feat(indeed): rewrite getBookedInterviews with real selectors and pagination"
```

---

### Task 4: Wire into `run-act.ts`

**Files:**
- Modify: `src/run-act.ts`

- [ ] **Step 1: Add `processBookedInterviews` call after `processPendingDecisions`**

Find this block in `src/run-act.ts`:

```typescript
  await agent.processPendingDecisions();
  clearTimeout(timeout);
  console.log('\n[Act] Complete.');
```

Replace it with:

```typescript
  await agent.processPendingDecisions();
  await agent.processBookedInterviews();
  clearTimeout(timeout);
  console.log('\n[Act] Complete.');
```

- [ ] **Step 2: Run tests to confirm all pass**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent && npx vitest run 2>&1 | tail -6
```

Expected: all 51 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/ryanray/Sites/flhc/recruiter-agent
git add src/run-act.ts
git commit -m "feat(act): run processBookedInterviews after processPendingDecisions"
```

---

## Self-Review

**Spec coverage:**
- ✅ `Interview` type updated: `indeedInterviewId` removed, `scheduledAt: string`
- ✅ `getBookedInterviews()` rewritten with real selectors: `interviewList`, `InterviewCard-Wrapper`, `interview-card-candidate`, `CandidateDetails-viewCandidateLink`, `interviewDetails-datetime`
- ✅ Pagination handled: `interviewList-ListPagination` buttons, next button disabled check, loop
- ✅ Click-per-card flow to open details pane
- ✅ `processBookedInterviews()` cross-references by `indeedId`
- ✅ Skips already-`Interview Scheduled` candidates
- ✅ Skips unmatched interviews
- ✅ Updates status + `lastContact`, posts Slack with name + raw time string
- ✅ Wired into `run-act.ts`
- ✅ 4 tests covering: happy path, already scheduled, no match, multiple interviews

**Placeholder scan:** None found.

**Type consistency:**
- `Interview.scheduledAt: string` defined in Task 1, used in Task 2 test fixtures and Task 3 implementation — consistent
- `processBookedInterviews()` signature consistent across Task 2 (implementation) and Task 4 (call site)
- `today()` referenced in Task 2 implementation — already defined in `src/agent.ts`, not redefined
