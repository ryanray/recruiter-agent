# Batched Slack Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each agent run (sense/evaluate and act) posts exactly one Slack message — the end-of-run summary, enriched with the links the removed per-candidate messages used to carry.

**Architecture:** Agent methods stop calling `slack.post` mid-run and instead return richer objects (URLs, reasons, counts) in the result arrays they already return. The existing summary formatters in `src/logger.ts` render those with Slack `<url|label>` links. Hire-flow "action required" items get a `<!here>`-prefixed section at the top of the act summary (fixing the existing bug where literal `@here` text never pings via `chat.postMessage`).

**Tech Stack:** TypeScript (ESM — all relative imports use `.js` suffix), vitest, Slack Web API (mrkdwn).

**Spec:** `docs/superpowers/specs/2026-07-22-batched-slack-notifications-design.md`

## Global Constraints

- Verification gate is `npm test` (149 tests passing at baseline). Do NOT use `npx tsc --noEmit` as a gate — it has pre-existing `rootDir` errors unrelated to this work.
- Console/file logging (`console.log` play-by-play) stays unchanged; only `slack.post` calls are removed.
- Slack link syntax is `<url|label>`; the here-mention must be `<!here>` (literal `@here` text does not notify).
- Commit messages: no `Co-Authored-By` trailers (user preference).
- Existing code style: 2-space indent, single quotes, semicolons. Match it.

---

### Task 1: Widen `humanReviewFlagged` (shared by both runs) and drop its two inline posts

The multi-job "⚠️ Human review needed" message is posted from two places: `evaluateCandidates` (sense run) and `processFollowUps` (act run). Both push to a `humanReviewFlagged` array that is currently `string[]`. Widen it to carry the other-job count and Indeed URL, remove both inline posts, and render the link in all three formatters that consume it.

**Files:**
- Modify: `src/types.ts` (~line 144 add interface; line 162 widen field)
- Modify: `src/agent.ts` (lines 103–107 multi-job in `evaluateCandidates`; lines 557–594 `processFollowUps`)
- Modify: `src/logger.ts` (`formatRunLog` ~100–105, `formatCandidateSummary` ~149–152, `formatActSummary` params + ~216–218)
- Test: `tests/pipeline.test.ts` (multi-job describe block, lines ~724–788), `tests/logger.test.ts`

**Interfaces:**
- Consumes: existing `RunResult`, `Agent.processFollowUps`, formatter functions.
- Produces: `HumanReviewFlag { name: string; otherJobCount: number; indeedUrl: string }` exported from `src/types.js`. `RunResult.humanReviewFlagged: HumanReviewFlag[]`. `processFollowUps` returns `humanReviewFlagged: HumanReviewFlag[]`. `formatActSummary` params take `humanReviewFlagged: HumanReviewFlag[]`. Tasks 2–4 rely on these exact names.

- [ ] **Step 1: Update the two multi-job pipeline tests to expect no Slack post and rich flag objects**

In `tests/pipeline.test.ts`, in the test `'adds Human Review row, posts Slack, populates humanReviewFlagged, skips Drive/scoring'` (~line 724): rename it to `'adds Human Review row, records flag in result, posts no individual Slack message'` and replace the assertions at the end (the `slack.messages` block and `result.humanReviewFlagged` line):

```ts
    expect(slack.messages).toHaveLength(0);

    expect(result.humanReviewFlagged).toEqual([{
      name: 'Multi Job',
      otherJobCount: 1,
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-multi',
    }]);
```

In `'processFollowUps flags Human Review candidate instead of sending follow-up'` (~line 766): change the destructure to `const { followUpsSent, humanReviewFlagged } = await agent.processFollowUps();` and replace the three `slack.messages` assertions at the end with:

```ts
    expect(slack.messages).toHaveLength(0);
    expect(humanReviewFlagged).toEqual([{
      name: 'Follow Up Person',
      otherJobCount: 1,
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-fu',
    }]);
```

- [ ] **Step 2: Add a formatter test for the widened type**

In `tests/logger.test.ts`, add inside the existing `describe('formatRunLog', ...)`:

```ts
  it('renders human review flags with other-job count', () => {
    const log = formatRunLog(makeResult({
      humanReviewFlagged: [{ name: 'Multi Job', otherJobCount: 2, indeedUrl: 'https://employers.indeed.com/candidates/view?id=x' }],
    }));
    expect(log).toContain('Multi Job — applied to 2 other job(s)');
  });
```

And add a new describe block at the bottom of the file (extend the import line to `import { formatRunLog, formatCandidateSummary } from '../src/logger.js';`):

```ts
describe('formatCandidateSummary', () => {
  it('renders human review flags with count and Indeed link', () => {
    const msg = formatCandidateSummary(makeResult({
      humanReviewFlagged: [{ name: 'Multi Job', otherJobCount: 2, indeedUrl: 'https://employers.indeed.com/candidates/view?id=x' }],
    }));
    expect(msg).toContain('*Flagged for Human Review (1):*');
    expect(msg).toContain('Multi Job — applied to 2 other job(s)  <https://employers.indeed.com/candidates/view?id=x|View in Indeed>');
  });
});
```

- [ ] **Step 3: Run the updated tests to verify they fail**

Run: `npx vitest run tests/pipeline.test.ts tests/logger.test.ts`
Expected: FAIL — pipeline tests still see 1 Slack message and string arrays; logger tests render `[object Object]`.

- [ ] **Step 4: Add the `HumanReviewFlag` type**

In `src/types.ts`, after the `RunError` interface (~line 144), add:

```ts
export interface HumanReviewFlag {
  name: string;
  otherJobCount: number;
  indeedUrl: string;
}
```

And change line 162 from `humanReviewFlagged: string[];` to:

```ts
  humanReviewFlagged: HumanReviewFlag[];
```

- [ ] **Step 5: Update `agent.ts` — remove both posts, push objects**

Add `HumanReviewFlag` to the `import type { ... } from './types.js'` list at the top of `src/agent.ts`.

In `evaluateCandidates` (~lines 101–108), replace:

```ts
          await this.sheets.addCandidate('Active', row);
          await this.safeLogEvent(applicant.name, 'applicant_added');
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `⚠️ *Human review needed:* ${applicant.name} has applied to ${profileFetchResult.otherJobCount} other job(s) on this account. Please review and decide how to proceed.\n<${applicant.indeedProfileUrl}|View in Indeed>`
          );
          result.humanReviewFlagged.push(applicant.name);
```

with:

```ts
          await this.sheets.addCandidate('Active', row);
          await this.safeLogEvent(applicant.name, 'applicant_added');
          result.humanReviewFlagged.push({
            name: applicant.name,
            otherJobCount: profileFetchResult.otherJobCount,
            indeedUrl: applicant.indeedProfileUrl,
          });
```

In `processFollowUps` (~line 557): change the return type's `humanReviewFlagged: string[]` to `humanReviewFlagged: HumanReviewFlag[]`, change the local declaration (~line 565) to `const humanReviewFlagged: HumanReviewFlag[] = [];`, and replace (~lines 588–594):

```ts
            await this.sheets.updateCandidateStatus(candidate.name, 'Human Review');
            await this.slack.post(
              this.config.slack.recruiting_channel,
              `⚠️ *Human review needed:* ${candidate.name} has applied to ${otherJobCount} other job(s) on this account. Please review and decide how to proceed.\n<${candidate.indeedUrl}|View in Indeed>`
            );
            humanReviewFlagged.push(candidate.name);
```

with:

```ts
            await this.sheets.updateCandidateStatus(candidate.name, 'Human Review');
            humanReviewFlagged.push({
              name: candidate.name,
              otherJobCount,
              indeedUrl: candidate.indeedUrl,
            });
```

- [ ] **Step 6: Update the three formatters in `logger.ts`**

Add the type import at the top of `src/logger.ts`: `import type { RunResult, HumanReviewFlag } from './types.js';`

`formatRunLog` (~lines 100–105) — replace the loop body:

```ts
  if (result.humanReviewFlagged.length > 0) {
    lines.push('', `HUMAN REVIEW FLAGGED (${result.humanReviewFlagged.length})`);
    for (const f of result.humanReviewFlagged) {
      lines.push(`  ⚠️ ${f.name} — applied to ${f.otherJobCount} other job(s), awaiting human decision`);
    }
  }
```

`formatCandidateSummary` (~lines 149–152) — replace:

```ts
  if (result.humanReviewFlagged.length > 0) {
    lines.push(`\n*Flagged for Human Review (${result.humanReviewFlagged.length}):*`);
    for (const f of result.humanReviewFlagged) {
      lines.push(`  ⚠️ ${f.name} — applied to ${f.otherJobCount} other job(s)  <${f.indeedUrl}|View in Indeed>`);
    }
  }
```

`formatActSummary`: change the param declaration `humanReviewFlagged: string[];` to `humanReviewFlagged: HumanReviewFlag[];` and replace its section (~lines 216–219):

```ts
  if (humanReviewFlagged.length > 0) {
    lines.push(`\n*Flagged for Human Review (${humanReviewFlagged.length}):*`);
    for (const f of humanReviewFlagged) {
      lines.push(`  • ${f.name} — applied to ${f.otherJobCount} other job(s)  <${f.indeedUrl}|View in Indeed>`);
    }
  }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all tests). `run-act.ts` and `run-candidates.ts` need no edits — they pass the values through.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/agent.ts src/logger.ts tests/pipeline.test.ts tests/logger.test.ts
git commit -m "feat: batch multi-job human-review flags into run summaries with links"
```

---

### Task 2: Sense run — previously-contacted and unsure batching

Remove the remaining two inline posts in `evaluateCandidates` ("⚠️ Previously contacted" and "❓ Review needed"), collect them on `RunResult`, and render them in `formatCandidateSummary`.

**Files:**
- Modify: `src/types.ts` (add `PreviouslyContactedFlag`; add `previouslyContacted` to `RunResult`; add `indeedUrl?` to `RunCandidateResult`)
- Modify: `src/agent.ts` (result init ~line 26; previously-contacted block ~112–119; unsure block ~236–249)
- Modify: `src/logger.ts` (`formatCandidateSummary` unsure section ~135–141; new section)
- Test: `tests/pipeline.test.ts` (UNSURE test ~147; previously-contacted guard block ~465–530), `tests/logger.test.ts`

**Interfaces:**
- Consumes: `RunResult`, `HumanReviewFlag` from Task 1.
- Produces: `PreviouslyContactedFlag { name: string; lastSeen: string; indeedUrl: string }` exported from `src/types.js`; `RunResult.previouslyContacted: PreviouslyContactedFlag[]`; `RunCandidateResult.indeedUrl?: string`.

- [ ] **Step 1: Update pipeline tests**

`'UNSURE candidate gets Active row and posts Slack alert'` (~line 147) — rename to `'UNSURE candidate gets Active row and lands in result.unsure with no individual Slack post'` and replace the body's assertions:

```ts
    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('UNSURE');
    expect(slack.messages).toHaveLength(0);
    expect(result.unsure).toHaveLength(1);
    expect(result.unsure[0].indeedUrl).toBe('https://employers.indeed.com/candidates/view?id=app-1');
```

In the `'Agent.evaluateCandidates — previously contacted guard'` block (~465–530):

Test `'flags applicant with prior contact within window: notes prefixed + Slack alert'` — rename the suffix to `+ recorded in result`, capture `const result = await agent.evaluateCandidates(...)`, and replace the `priorAlert` assertions with:

```ts
      expect(slack.messages).toHaveLength(0);
      expect(result.previouslyContacted).toEqual([{
        name: 'Jane Doe',
        lastSeen: yesterday,
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      }]);
      expect(sheets.tabs['Active'][0].notes).toMatch(/^\[Previously contacted:/);
```

Tests `'does not flag applicant with prior contact outside window'` and `'processes normally when no prior contact record exists'` — capture the result and replace the `slack.messages.filter(...)` assertion with:

```ts
      expect(result.previouslyContacted).toHaveLength(0);
```

Test `'matches case-insensitively: ...'` — capture the result and replace the `slack.messages.find(...)` assertion with:

```ts
      expect(result.previouslyContacted).toHaveLength(1);
```

- [ ] **Step 2: Update logger test fixture and add rendering tests**

In `tests/logger.test.ts` `makeResult`, add `previouslyContacted: [],` after `humanReviewFlagged: [],`. Add to the `formatCandidateSummary` describe block:

```ts
  it('renders unsure entries with an Indeed link', () => {
    const msg = formatCandidateSummary(makeResult({
      unsure: [{ name: 'Jane Doe', location: '', experience: '', certifications: '', unclearField: 'Cannot determine distance', indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1' }],
    }));
    expect(msg).toContain('? Jane Doe — Cannot determine distance');
    expect(msg).toContain('<https://employers.indeed.com/candidates/view?id=app-1|View in Indeed>');
  });

  it('renders previously contacted section with last-seen date and link', () => {
    const msg = formatCandidateSummary(makeResult({
      previouslyContacted: [{ name: 'Jane Doe', lastSeen: '2026-05-01', indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1' }],
    }));
    expect(msg).toContain('*Previously contacted (1):*');
    expect(msg).toContain('Jane Doe — last seen 2026-05-01  <https://employers.indeed.com/candidates/view?id=app-1|View in Indeed>');
  });
```

- [ ] **Step 3: Run the updated tests to verify they fail**

Run: `npx vitest run tests/pipeline.test.ts tests/logger.test.ts`
Expected: FAIL — `previouslyContacted` doesn't exist yet; unsure entries have no `indeedUrl`; Slack posts still fire.

- [ ] **Step 4: Add types**

In `src/types.ts`, after `HumanReviewFlag`:

```ts
export interface PreviouslyContactedFlag {
  name: string;
  lastSeen: string;
  indeedUrl: string;
}
```

In `RunResult`, after the `humanReviewFlagged` line: `previouslyContacted: PreviouslyContactedFlag[];`
In `RunCandidateResult`, after `unclearField?: string;`: `indeedUrl?: string;`

- [ ] **Step 5: Update `evaluateCandidates`**

In the `result` initializer (~line 33), after `humanReviewFlagged: [],` add `previouslyContacted: [],`.

Replace the previously-contacted block (~lines 112–119):

```ts
        const priorContact = priorContactMap.get(applicant.name.toLowerCase());
        if (priorContact) {
          console.log(`[Agent] ${applicant.name} was previously contacted on ${priorContact} — flagging for human review.`);
          result.previouslyContacted.push({
            name: applicant.name,
            lastSeen: priorContact,
            indeedUrl: applicant.indeedProfileUrl,
          });
        }
```

In the unsure branch (~lines 236–249), add `indeedUrl` to the pushed object and delete the `slack.post` call:

```ts
        } else {
          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            score: score.score,
            tier: score.tier,
            unclearField: screening.reasons.join('; '),
            indeedUrl: applicant.indeedProfileUrl,
          });
        }
```

- [ ] **Step 6: Update `formatCandidateSummary`**

Unsure section (~lines 135–141):

```ts
  if (result.unsure.length > 0) {
    lines.push(`\n*Unsure — needs review (${result.unsure.length}):*`);
    for (const c of result.unsure) {
      const scoreStr = c.score != null ? `  ${c.score}/100 (${c.tier})` : '';
      const linkStr = c.indeedUrl ? `  <${c.indeedUrl}|View in Indeed>` : '';
      lines.push(`  ? ${c.name} — ${c.unclearField}${scoreStr}${linkStr}`);
    }
  }
```

After the Flagged-for-Human-Review section, before the `newApplicantsReviewed === 0` check:

```ts
  if (result.previouslyContacted.length > 0) {
    lines.push(`\n*Previously contacted (${result.previouslyContacted.length}):*`);
    for (const p of result.previouslyContacted) {
      lines.push(`  • ${p.name} — last seen ${p.lastSeen}  <${p.indeedUrl}|View in Indeed>`);
    }
  }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/agent.ts src/logger.ts tests/pipeline.test.ts tests/logger.test.ts
git commit -m "feat: batch unsure and previously-contacted alerts into evaluate summary"
```

---

### Task 3: Act run — booked-interview batching

Remove the per-booking "🗓 Interview scheduled" post; `newlyBooked` entries carry score and links; `formatActSummary` renders them.

**Files:**
- Modify: `src/types.ts` (add `BookedInterviewNotice`)
- Modify: `src/agent.ts` (`processBookedInterviews` ~443–471)
- Modify: `src/logger.ts` (`formatActSummary` params + Interviews-booked section ~187–190)
- Test: `tests/pipeline.test.ts` (`Agent.processBookedInterviews` block ~383–463), `tests/logger.test.ts`

**Interfaces:**
- Consumes: `CandidateRow` fields `score?: string`, `scoreTier?: string`, `indeedUrl: string`, `driveFolder?: string`.
- Produces: `BookedInterviewNotice { name: string; scheduledAt: string; score?: string; tier?: string; indeedUrl: string; driveFolder?: string }` exported from `src/types.js`; `processBookedInterviews` returns `{ newlyBooked: BookedInterviewNotice[] }`; `formatActSummary` takes `newlyBooked: BookedInterviewNotice[]`. Task 4 relies on the `makeActParams` helper added here.

- [ ] **Step 1: Update pipeline tests**

`'updates status, lastContact, and posts Slack when interview is booked'` (~line 398) — rename to `'updates status, lastContact, and returns booked notice when interview is booked'`; capture the return and replace the Slack assertions:

```ts
      const { newlyBooked } = await agent.processBookedInterviews();

      expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
      expect(sheets.tabs['Active'][0].lastContact).toBeTruthy();
      expect(slack.messages).toHaveLength(0);
      expect(newlyBooked).toEqual([{
        name: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
        score: undefined,
        tier: undefined,
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
        driveFolder: '',
      }]);
```

`'processes multiple booked interviews'` (~line 445) — capture `const { newlyBooked } = ...` and replace `expect(slack.messages).toHaveLength(2);` with:

```ts
      expect(slack.messages).toHaveLength(0);
      expect(newlyBooked).toHaveLength(2);
```

The two skip tests (~417, ~433) keep `expect(slack.messages).toHaveLength(0);` unchanged.

- [ ] **Step 2: Add `formatActSummary` rendering test**

In `tests/logger.test.ts`, extend the logger import with `formatActSummary`, and add:

```ts
function makeActParams(overrides: Record<string, unknown> = {}) {
  return {
    actioned: [],
    newlyBooked: [],
    followUpsSent: [],
    neverResponded: [],
    humanReviewFlagged: [],
    interviewResultsProcessed: [],
    inPersonReminders: [],
    ...overrides,
  };
}

describe('formatActSummary', () => {
  it('renders booked interviews with score and links', () => {
    const msg = formatActSummary(makeActParams({
      newlyBooked: [{
        name: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
        score: '82', tier: 'Tier 1',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }],
    }));
    expect(msg).toContain('*Interviews booked (1):*');
    expect(msg).toContain('Jane Doe — Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)  |  82/100 (Tier 1)');
    expect(msg).toContain('<https://employers.indeed.com/candidates/view?id=app-1|Open on Indeed>');
    expect(msg).toContain('<https://drive.google.com/drive/folders/folder-1|Open on Google Drive>');
  });

  it('omits score and Drive link when absent', () => {
    const msg = formatActSummary(makeActParams({
      newlyBooked: [{
        name: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      }],
    }));
    expect(msg).toContain('Jane Doe — Thursday, June 5, 2026  |  <https://employers.indeed.com/candidates/view?id=app-1|Open on Indeed>');
    expect(msg).not.toContain('/100');
    expect(msg).not.toContain('Google Drive');
  });
});
```

- [ ] **Step 3: Run the updated tests to verify they fail**

Run: `npx vitest run tests/pipeline.test.ts tests/logger.test.ts`
Expected: FAIL — `processBookedInterviews` still posts and returns bare `{name, scheduledAt}`; summary lines have no links.

- [ ] **Step 4: Add the type and update `processBookedInterviews`**

In `src/types.ts`, after `PreviouslyContactedFlag`:

```ts
export interface BookedInterviewNotice {
  name: string;
  scheduledAt: string;
  score?: string;
  tier?: string;
  indeedUrl: string;
  driveFolder?: string;
}
```

In `src/agent.ts` (add `BookedInterviewNotice` to the type import): change the signature to `async processBookedInterviews(): Promise<{ newlyBooked: BookedInterviewNotice[] }>`, the local to `const newlyBooked: BookedInterviewNotice[] = [];`, and replace the post + push (~lines 463–468):

```ts
      await this.sheets.updateCandidateStatus(candidate.name, 'Interview Scheduled', { lastContact: today(), interviewScheduledAt: today() });
      newlyBooked.push({
        name: candidate.name,
        scheduledAt: interview.scheduledAt,
        score: candidate.score,
        tier: candidate.scoreTier,
        indeedUrl: candidate.indeedUrl,
        driveFolder: candidate.driveFolder,
      });
```

- [ ] **Step 5: Update `formatActSummary`**

Change the param `newlyBooked: { name: string; scheduledAt: string }[];` to `newlyBooked: BookedInterviewNotice[];` (add `BookedInterviewNotice` to logger's type import) and replace the section (~lines 187–190):

```ts
  if (newlyBooked.length > 0) {
    lines.push(`\n*Interviews booked (${newlyBooked.length}):*`);
    for (const b of newlyBooked) {
      const scoreStr = b.score ? `  |  ${b.score}/100 (${b.tier})` : '';
      const links = [`<${b.indeedUrl}|Open on Indeed>`];
      if (b.driveFolder) links.push(`<${b.driveFolder}|Open on Google Drive>`);
      lines.push(`  • ${b.name} — ${b.scheduledAt}${scoreStr}  |  ${links.join('  |  ')}`);
    }
  }
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/agent.ts src/logger.ts tests/pipeline.test.ts tests/logger.test.ts
git commit -m "feat: batch interview-booked alerts into act summary with score and links"
```

---

### Task 4: Act run — holds, action-required, and `<!here>`

Remove the last three inline posts (hold alert and the two hire-flow `@here` alerts). `processPendingDecisions` returns `holds` and `actionRequired`; the act summary opens with a `<!here>` Action-required section when needed.

**Files:**
- Modify: `src/types.ts` (add `HoldNotice`, `ActionRequiredItem`)
- Modify: `src/agent.ts` (`processPendingDecisions` ~270–441: signature, hold branch ~359–365, missing-sheet ~384–389, missing-offer-info ~394–400, return)
- Modify: `src/logger.ts` (`formatActSummary`: params, header, holds section, nothing-to-act-on condition)
- Modify: `src/run-act.ts` (~lines 33, 48)
- Test: `tests/pipeline.test.ts` (Hold test ~363; hire describe ~825–948), `tests/logger.test.ts`

**Interfaces:**
- Consumes: Task 3's `makeActParams` helper; `formatActSummary`.
- Produces: `HoldNotice { name: string; agentRecommendation: string; notes: string; indeedUrl: string }` and `ActionRequiredItem { name: string; issue: string; link?: string }` exported from `src/types.js`; `processPendingDecisions` returns `{ actioned, holds, actionRequired }`; `formatActSummary` params gain `holds: HoldNotice[]` and `actionRequired: ActionRequiredItem[]`.

- [ ] **Step 1: Update pipeline tests**

Hold test (~line 363) — rename to `'Hold: clears humanDecision, records hold in result, posts no individual Slack message'`; capture the return and replace the Slack assertions:

```ts
      const { holds } = await agent.processPendingDecisions();

      expect(indeed.markedSentiments).toHaveLength(0);
      expect(drive.moves).toHaveLength(0);
      expect(slack.messages).toHaveLength(0);
      expect(holds).toEqual([{
        name: 'Jane Doe',
        agentRecommendation: 'UNSURE',
        notes: 'Cannot determine distance',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      }]);
      expect(sheets.tabs['Active'][0].humanDecision).toBe('None');
```

In the `'Agent — hire decision'` block:

`'posts Slack @here alert when offer info has missing fields, hire still completes'` (~878) — rename to `'records action-required item when offer info has missing fields, hire still completes'`; capture `const { actionRequired } = await agent.processPendingDecisions();` and replace the Slack assertions:

```ts
      expect(slack.messages).toHaveLength(0);
      expect(actionRequired).toHaveLength(1);
      expect(actionRequired[0].name).toBe('Ray, Ryan');
      expect(actionRequired[0].issue).toContain('missing offer info');
      expect(actionRequired[0].link).toBe('https://docs.google.com/spreadsheets/d/fake-sheet-id/edit');
      expect(sheets.tabs['Hired']).toHaveLength(1);
      expect(sheets.trackerRows).toHaveLength(1);
```

`'includes justification in missing fields when rate > 16 and justification is blank'` (~893) — capture `actionRequired` and replace the Slack assertions:

```ts
      expect(actionRequired).toHaveLength(1);
      expect(actionRequired[0].issue).toContain('justification');
```

`'does not flag justification as missing when rate is exactly 16'` (~904) — capture `actionRequired` and replace the Slack assertion:

```ts
      expect(actionRequired).toHaveLength(0);
      expect(slack.messages).toHaveLength(0);
```

`'posts Slack alert about missing sheet when no spreadsheet found in folder, hire still completes'` (~914) — rename to `'records action-required item about missing sheet when no spreadsheet found in folder, hire still completes'`; capture `actionRequired` and replace the Slack assertions:

```ts
      expect(slack.messages).toHaveLength(0);
      expect(actionRequired).toEqual([{
        name: 'Ray, Ryan',
        issue: 'could not find interview questions sheet — please verify their Drive folder',
      }]);
      expect(sheets.tabs['Hired']).toHaveLength(1);
      expect(sheets.trackerRows).toContainEqual({ lastName: 'Ray', firstName: 'Ryan', startDate: '' });
```

- [ ] **Step 2: Add `formatActSummary` tests for `<!here>` and holds**

In `tests/logger.test.ts`, add `holds: [], actionRequired: [],` to the `makeActParams` helper, and add inside `describe('formatActSummary', ...)`:

```ts
  it('starts with <!here> and an Action required section when actionRequired is non-empty', () => {
    const msg = formatActSummary(makeActParams({
      actionRequired: [{ name: 'Ray, Ryan', issue: 'missing offer info (start date)', link: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
    }));
    expect(msg.startsWith('<!here>')).toBe(true);
    expect(msg).toContain('🚨 Action required (1)');
    expect(msg).toContain('Ray, Ryan — missing offer info (start date)  <https://docs.google.com/spreadsheets/d/abc/edit|Open sheet>');
  });

  it('omits <!here> and still reports nothing to act on when everything is empty', () => {
    const msg = formatActSummary(makeActParams());
    expect(msg).not.toContain('<!here>');
    expect(msg).toContain('_Nothing to act on._');
  });

  it('renders holds with recommendation, notes, and Indeed link', () => {
    const msg = formatActSummary(makeActParams({
      holds: [{ name: 'Jane Doe', agentRecommendation: 'UNSURE', notes: 'Cannot determine distance', indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1' }],
    }));
    expect(msg).toContain('*🚩 Held for review (1):*');
    expect(msg).toContain('Jane Doe — Agent: UNSURE — Cannot determine distance  <https://employers.indeed.com/candidates/view?id=app-1|View in Indeed>');
    expect(msg).not.toContain('_Nothing to act on._');
  });
```

- [ ] **Step 3: Run the updated tests to verify they fail**

Run: `npx vitest run tests/pipeline.test.ts tests/logger.test.ts`
Expected: FAIL — no `holds`/`actionRequired` in returns or params yet.

- [ ] **Step 4: Add types**

In `src/types.ts`, after `BookedInterviewNotice`:

```ts
export interface HoldNotice {
  name: string;
  agentRecommendation: string;
  notes: string;
  indeedUrl: string;
}

export interface ActionRequiredItem {
  name: string;
  issue: string;
  link?: string;
}
```

- [ ] **Step 5: Update `processPendingDecisions`**

Add `HoldNotice, ActionRequiredItem` to agent.ts's type import. Change the signature and locals (~lines 270–271):

```ts
  async processPendingDecisions(): Promise<{
    actioned: { name: string; decision: string }[];
    holds: HoldNotice[];
    actionRequired: ActionRequiredItem[];
  }> {
    const actioned: { name: string; decision: string }[] = [];
    const holds: HoldNotice[] = [];
    const actionRequired: ActionRequiredItem[] = [];
```

Hold branch (~359–365) — replace:

```ts
        } else if (decision === 'hold') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name} (Hold — flagged in run summary)...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });
          holds.push({
            name: candidate.name,
            agentRecommendation: candidate.agentRecommendation,
            notes: candidate.notes,
            indeedUrl: candidate.indeedUrl,
          });
        } else if (decision === 'hire') {
```

Missing-sheet branch (~384–389) — replace the `slack.post` with:

```ts
          if (!spreadsheet) {
            console.warn(`[Agent] No spreadsheet found in folder for ${candidate.name} — skipping Offer Info check.`);
            actionRequired.push({
              name: candidate.name,
              issue: 'could not find interview questions sheet — please verify their Drive folder',
            });
          } else {
```

Missing-offer-info branch (~394–400) — replace the `slack.post` with:

```ts
            if (missingFields.length > 0) {
              console.warn(`[Agent] Missing offer info for ${candidate.name}: ${missingFields.join(', ')}`);
              const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.id}/edit`;
              actionRequired.push({
                name: candidate.name,
                issue: `missing offer info (${missingFields.join(', ')})`,
                link: sheetUrl,
              });
            } else {
```

Change the final `return { actioned };` to `return { actioned, holds, actionRequired };`

- [ ] **Step 6: Update `formatActSummary` and `run-act.ts`**

In `src/logger.ts` (add `HoldNotice, ActionRequiredItem` to the type import), add to the params interface: `holds: HoldNotice[];` and `actionRequired: ActionRequiredItem[];`. Add them to the destructure line. Replace the header construction:

```ts
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const header = `*Chandler — Act Run* (${timestamp} UTC)`;
  const lines: string[] = actionRequired.length > 0 ? [`<!here> ${header}`] : [header];

  if (actionRequired.length > 0) {
    lines.push(`\n*🚨 Action required (${actionRequired.length}):*`);
    for (const a of actionRequired) {
      lines.push(`  • ${a.name} — ${a.issue}${a.link ? `  <${a.link}|Open sheet>` : ''}`);
    }
  }
```

After the Interviews-booked section, add:

```ts
  if (holds.length > 0) {
    lines.push(`\n*🚩 Held for review (${holds.length}):*`);
    for (const h of holds) {
      const notesStr = h.notes ? ` — ${h.notes}` : '';
      lines.push(`  • ${h.name} — Agent: ${h.agentRecommendation}${notesStr}  <${h.indeedUrl}|View in Indeed>`);
    }
  }
```

Extend the nothing-to-act-on condition to include the new arrays:

```ts
  if (actioned.length === 0 && newlyBooked.length === 0 && followUpsSent.length === 0 &&
      neverResponded.length === 0 && humanReviewFlagged.length === 0 &&
      interviewResultsProcessed.length === 0 && inPersonReminders.length === 0 &&
      holds.length === 0 && actionRequired.length === 0) {
    lines.push('\n_Nothing to act on._');
  }
```

In `src/run-act.ts`: change line 33 to `const { actioned, holds, actionRequired } = await agent.processPendingDecisions();` and pass both through on line 48:

```ts
  await slack.post(config.slack.recruiting_channel, formatActSummary({ actioned, holds, actionRequired, newlyBooked, followUpsSent, neverResponded, humanReviewFlagged, interviewResultsProcessed, inPersonReminders }));
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/agent.ts src/logger.ts src/run-act.ts tests/pipeline.test.ts tests/logger.test.ts
git commit -m "feat: batch hold and action-required alerts into act summary with <!here>"
```

---

### Task 5: Docs and release process

All eight inline posts are gone; each run now posts exactly one message. Update user-facing docs that describe the old per-candidate alerts, and follow the repo's release process.

**Files:**
- Modify: `README.md` (line 21: Hold row; line 143: urgent-alert claim)
- Modify: `src/scripts/create-docs.ts` (lines ~74, ~113, ~148–157, ~181–185: Slack alert descriptions)

**Interfaces:**
- Consumes: final behavior from Tasks 1–4.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Update README.md**

Line 21 — change the Hold row from `| \`Hold\` | Posts a Slack alert for manual review |` to:

```markdown
| `Hold` | Flagged in the act-run Slack summary for manual review |
```

Line 143 — the claim that an urgent candidate fires an immediate Slack alert is stale (no such post exists in the code). Reword to describe what urgency actually affects, e.g. remove the parenthetical `(Slack alert fires immediately)`.

- [ ] **Step 2: Update `src/scripts/create-docs.ts`**

Rework the Slack-related HTML so it describes the batched behavior:

- ~Line 74: `Posts Slack alerts for anything that needs human attention` → `Posts one Slack summary per run, with links for anything that needs human attention`.
- ~Line 113 (Hold row): `Posts a Slack alert for the team to discuss — no other action` → `Listed under "Held for review" in the act-run summary — no other action`.
- ~Lines 148–157 ("Slack Alerts — What They Mean" table): retitle to "Run Summaries — What the Sections Mean" and describe the summary sections (🚨 Action required with `@here`, 🚩 Held for review, Interviews booked, ⚠️ Flagged for Human Review, ❓ Unsure, Previously contacted) instead of individual alerts. Keep the guidance text for each (what the reader should do).
- ~Lines 181–185: update the three bullets that say "watch for the ⚠️/❓ alert" to point at the summary sections instead.

- [ ] **Step 3: Regenerate the Google Doc**

Run: `npm run create-docs`
Expected: script completes and prints the updated doc URL.

- [ ] **Step 4: Run the full suite one final time**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add README.md src/scripts/create-docs.ts
git commit -m "docs: describe batched Slack run summaries"
```

- [ ] **Step 6: Announce (requires user confirmation)**

Per the repo's release process, post a Slack announcement about the change, e.g.:

Run: `npm run announce-update -- "Chandler update: runs now post a single Slack summary instead of individual alerts. Action-required items appear at the top with @here and links; holds, bookings, and review flags each have their own section with Indeed/Drive links."`

**Check with the user before running this** — it posts to the live recruiting channel.
