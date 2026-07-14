# Weekly Recruiting Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `weekly-report` command that reports six recruiting metrics for a date range, fed by a new append-only Events tab that Chandler writes to as it works, plus a one-time backfill from local run logs.

**Architecture:** Chandler logs one row per reportable event to an `Events` tab in the tracker spreadsheet (via a new `logEvent` adapter method called from six places in `agent.ts`). The report command reads the tab, filters by date range, counts by event type, and outputs to console + Slack. Pure logic (date parsing, counting, formatting, log parsing) lives in `src/report.ts` and `src/backfill.ts` so it is unit-testable without API calls; scripts in `src/scripts/` do the I/O wiring.

**Tech Stack:** TypeScript (ESM, run via `npx tsx`), googleapis (Sheets v4), Slack Web API via existing `SlackService`, vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-weekly-report-design.md`

## Global Constraints

- **Prerequisite:** the working branch must contain commit `96da9ba` ("fix: treat 'None' as blank..."). Verify with `git branch --contains 96da9ba`. If `main` lacks it, merge `feat/interview-result-columns` (PR #2) first — Task 2 edits `processInterviewResults`, which that commit also touches.
- ESM project: every relative import ends in `.js` (e.g., `import { loadConfig } from '../config.js'`). No default exports.
- Event type strings, exactly: `applicant_added`, `invite_sent`, `follow_up_sent`, `phone_no_show`, `in_person_no_show`, `hired`.
- Events tab: named `Events`, columns A–D with header row `Date | Candidate | Event | Detail`.
- Event dates are `YYYY-MM-DD` produced by `new Date().toISOString().slice(0, 10)` (UTC date — the codebase-wide convention used by `today()` in `agent.ts`). The backfill derives the same UTC date from log filenames.
- Event logging must never propagate an error into an agent flow (wrap in try/catch, warn, continue).
- Log an event only AFTER the action it records has succeeded.
- Report command input dates are `M/D/YYYY`; the range is inclusive on both ends. Zero counts print as `0`.
- Report output format, verbatim (labels come from the raw CLI args):

```
📊 Weekly Recruiting Report: 7/6/2026 – 7/12/2026
• New applicants: 12
• Phone interview invites sent: 8
• Follow-up invites sent: 5
• Phone interview no-shows: 2
• In-person no-shows: 1
• Offers sent (hired): 1
```

- Run tests with `npm test` (vitest). Type-check with `npx tsc --noEmit`.

---

## File Structure

- Create: `src/report.ts` — pure report logic (date parsing, counting, formatting)
- Create: `src/backfill.ts` — pure log-line parsing and dedup logic
- Create: `src/scripts/add-events-tab.ts` — one-time Events tab setup
- Create: `src/scripts/weekly-report.ts` — report command (I/O wiring)
- Create: `src/scripts/backfill-events.ts` — one-time backfill (I/O wiring)
- Modify: `src/types.ts` — `EventType`, `SheetsAdapter.logEvent`
- Modify: `src/adapters/sheets.ts` — `logEvent` implementation
- Modify: `src/fakes/sheets.fake.ts` — fake `logEvent` + `events` array
- Modify: `src/agent.ts` — `safeLogEvent` helper + six call sites
- Modify: `package.json` — three new scripts
- Test: `tests/report.test.ts`, `tests/backfill.test.ts`, extend `tests/pipeline.test.ts`

---

### Task 1: `EventType` and the `logEvent` adapter method

**Files:**
- Modify: `src/types.ts` (add `EventType`; extend `SheetsAdapter`)
- Modify: `src/adapters/sheets.ts` (implement `logEvent`)
- Modify: `src/fakes/sheets.fake.ts` (fake `logEvent` + `events` array)
- Test: `tests/pipeline.test.ts` (extend the `FakeSheetsAdapter new methods` describe block near the bottom of the file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `type EventType = 'applicant_added' | 'invite_sent' | 'follow_up_sent' | 'phone_no_show' | 'in_person_no_show' | 'hired'` (exported from `src/types.ts`); `logEvent(candidate: string, event: EventType, detail?: string): Promise<void>` on `SheetsAdapter`; `FakeSheetsAdapter.events: { date: string; candidate: string; event: EventType; detail: string }[]` (Task 2's tests assert against this array).

- [ ] **Step 1: Write the failing tests**

In `tests/pipeline.test.ts`, find `describe('FakeSheetsAdapter new methods', ...)` (around line 1134) and add inside it:

```typescript
it('logEvent records an event with today\'s date and empty detail by default', async () => {
  await sheets.logEvent('Jane Doe', 'invite_sent');
  expect(sheets.events).toHaveLength(1);
  expect(sheets.events[0]).toEqual({
    date: new Date().toISOString().slice(0, 10),
    candidate: 'Jane Doe',
    event: 'invite_sent',
    detail: '',
  });
});

it('logEvent records the detail when provided', async () => {
  await sheets.logEvent('Jane Doe', 'follow_up_sent', '2');
  expect(sheets.events[0].detail).toBe('2');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pipeline.test.ts`
Expected: FAIL — `sheets.logEvent is not a function` (TypeScript may also refuse to compile; either failure mode is fine).

- [ ] **Step 3: Add the type and interface method**

In `src/types.ts`, below the `CandidateStatus` type, add:

```typescript
export type EventType =
  | 'applicant_added'
  | 'invite_sent'
  | 'follow_up_sent'
  | 'phone_no_show'
  | 'in_person_no_show'
  | 'hired';
```

In the `SheetsAdapter` interface (same file), after `addToTracker(...)`, add:

```typescript
  logEvent(candidate: string, event: EventType, detail?: string): Promise<void>;
```

- [ ] **Step 4: Implement in the real adapter**

In `src/adapters/sheets.ts`, add `EventType` to the type import from `../types.js`, then add this method to `SheetsService` (after `addToTracker`):

```typescript
  async logEvent(candidate: string, event: EventType, detail?: string): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const date = new Date().toISOString().slice(0, 10);
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Events!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[date, candidate, event, detail ?? '']] },
    });
  }
```

- [ ] **Step 5: Implement in the fake**

In `src/fakes/sheets.fake.ts`, add `EventType` to the type import from `../types.js`. Add a field to the class (next to `trackerRows`):

```typescript
  events: { date: string; candidate: string; event: EventType; detail: string }[] = [];
```

And the method (after `addToTracker`):

```typescript
  async logEvent(candidate: string, event: EventType, detail?: string): Promise<void> {
    this.events.push({
      date: new Date().toISOString().slice(0, 10),
      candidate,
      event,
      detail: detail ?? '',
    });
  }
```

- [ ] **Step 6: Run tests and type-check to verify they pass**

Run: `npm test -- tests/pipeline.test.ts` — Expected: PASS (all tests).
Run: `npx tsc --noEmit` — Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/adapters/sheets.ts src/fakes/sheets.fake.ts tests/pipeline.test.ts
git commit -m "feat: add EventType and logEvent to sheets adapter"
```

---

### Task 2: Event logging from the six agent flows

**Files:**
- Modify: `src/agent.ts` (add `safeLogEvent` private method + six call sites)
- Test: `tests/pipeline.test.ts` (new describe block)

**Interfaces:**
- Consumes: `SheetsAdapter.logEvent` and `EventType` from Task 1; `FakeSheetsAdapter.events` for assertions.
- Produces: nothing new for later tasks (events flow into the sheet at runtime).

**Context for the implementer:** `src/agent.ts` is the orchestrator. The relevant flows: `evaluateCandidates` adds new candidate rows (two `addCandidate('Active', row)` calls — one in the multi-job human-review path around line 101, one in the normal screening path around line 202). `processPendingDecisions` sends the initial interview invite when a human approves (the `updateCandidateStatus(..., 'Screened - Invite Sent', { lastContact: today(), inviteSentAt: today(), inviteCount: '1' })` call) and moves hired candidates (`moveCandidate(candidate.name, 'Active', 'Hired')`). `processFollowUps` sends follow-up invites. `processInterviewResults` handles the No-Show results. Events must be logged AFTER the action succeeds.

- [ ] **Step 1: Write the failing tests**

Add this describe block to `tests/pipeline.test.ts` (after the `Agent.processInterviewResults` block; reuse the file's existing helpers `makeCandidate`, `makeApplicant`, `passResult`, `defaultScore`, and `config`):

```typescript
describe('Agent event logging', () => {
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
    agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
  });

  it('logs applicant_added when a screened applicant is added to the sheet', async () => {
    indeed.seedApplicants([makeApplicant()]);
    await agent.evaluateCandidates(new Date('2026-01-01'), new Set(), () => {});
    expect(sheets.events.filter(e => e.event === 'applicant_added')).toEqual([
      expect.objectContaining({ candidate: 'Jane Doe', event: 'applicant_added', detail: '' }),
    ]);
  });

  it('logs applicant_added when a multi-job applicant is flagged for human review', async () => {
    indeed.seedApplicants([makeApplicant()]);
    indeed.multiJobApplicantIds.add('app-1');
    await agent.evaluateCandidates(new Date('2026-01-01'), new Set(), () => {});
    expect(sheets.events.filter(e => e.event === 'applicant_added')).toHaveLength(1);
  });

  it('logs invite_sent when an approved candidate gets the initial invite', async () => {
    sheets.tabs['Active'].push(makeCandidate({ humanDecision: 'Approve' }));
    await agent.processPendingDecisions();
    expect(sheets.events.filter(e => e.event === 'invite_sent')).toEqual([
      expect.objectContaining({ candidate: 'Jane Doe', detail: '' }),
    ]);
  });

  it('logs follow_up_sent with the follow-up number as detail', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      status: 'Screened - Invite Sent',
      lastContact: '2026-01-01',
      inviteCount: '1',
    }));
    await agent.processFollowUps();
    expect(sheets.events.filter(e => e.event === 'follow_up_sent')).toEqual([
      expect.objectContaining({ candidate: 'Jane Doe', detail: '1' }),
    ]);
  });

  it('logs phone_no_show when a phone No-Show result is processed', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      status: 'Interview Scheduled',
      phoneInterviewResult: 'No-Show',
    }));
    await agent.processInterviewResults();
    expect(sheets.events.filter(e => e.event === 'phone_no_show')).toHaveLength(1);
  });

  it('does NOT log phone_no_show for a phone Failed result', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      status: 'Interview Scheduled',
      phoneInterviewResult: 'Failed',
    }));
    await agent.processInterviewResults();
    expect(sheets.events).toHaveLength(0);
  });

  it('logs in_person_no_show when an in-person No-Show result is processed', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      status: 'In-Person Interview Scheduled',
      inPersonInterviewResult: 'No-Show',
    }));
    await agent.processInterviewResults();
    expect(sheets.events.filter(e => e.event === 'in_person_no_show')).toHaveLength(1);
  });

  it('logs hired when a candidate is moved to the Hired tab', async () => {
    sheets.tabs['Active'].push(makeCandidate({ humanDecision: 'Hire', driveFolder: '' }));
    await agent.processPendingDecisions();
    expect(sheets.events.filter(e => e.event === 'hired')).toEqual([
      expect.objectContaining({ candidate: 'Jane Doe' }),
    ]);
    expect(sheets.tabs['Hired']).toHaveLength(1);
  });

  it('a throwing logEvent does not break the flow', async () => {
    sheets.logEvent = async () => { throw new Error('boom'); };
    sheets.tabs['Active'].push(makeCandidate({
      status: 'Interview Scheduled',
      phoneInterviewResult: 'No-Show',
    }));
    const { processed } = await agent.processInterviewResults();
    expect(processed).toHaveLength(1);
    expect(sheets.tabs['Active'][0].humanDecision).toBe('Reject');
  });
});
```

Note: `FakeIndeedAdapter.multiJobApplicantIds` makes `fetchProfileData` report `otherJobCount: 1` for that applicant id, which routes the applicant down the human-review path. `makeApplicant()` uses id `app-1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pipeline.test.ts`
Expected: the new tests FAIL (no events recorded); all pre-existing tests still PASS.

- [ ] **Step 3: Add the `safeLogEvent` helper to `Agent`**

In `src/agent.ts`, add `EventType` to the type import from `./types.js`, and add this private method to the `Agent` class (next to `buildRow`):

```typescript
  private async safeLogEvent(candidate: string, event: EventType, detail?: string): Promise<void> {
    try {
      await this.sheets.logEvent(candidate, event, detail);
    } catch (err) {
      console.warn(`[Agent] Failed to log event ${event} for ${candidate}: ${err instanceof Error ? err.message : err}`);
    }
  }
```

- [ ] **Step 4: Add the six call sites**

Each call goes immediately AFTER the statement it records, inside the same try block:

**(a) applicant_added — human-review path** (~line 101). After:
```typescript
          await this.sheets.addCandidate('Active', row);
```
add:
```typescript
          await this.safeLogEvent(applicant.name, 'applicant_added');
```

**(b) applicant_added — normal screening path** (~line 202). After:
```typescript
        console.log(`[Agent] Adding to Active sheet...`);
        await this.sheets.addCandidate('Active', row);
```
add:
```typescript
        await this.safeLogEvent(applicant.name, 'applicant_added');
```

**(c) invite_sent — approve path in `processPendingDecisions`** (~line 306). After:
```typescript
          await this.sheets.updateCandidateStatus(
            candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteSentAt: today(), inviteCount: '1' }
          );
```
add:
```typescript
          await this.safeLogEvent(candidate.name, 'invite_sent');
```

**(d) hired — hire path in `processPendingDecisions`** (~line 414). After:
```typescript
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Hired');
```
add:
```typescript
          await this.safeLogEvent(candidate.name, 'hired');
```

**(e) follow_up_sent — in `processFollowUps`** (~line 624). After:
```typescript
        await this.sheets.updateCandidateStatus(
          candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteCount: String(nextCount) }
        );
```
add (note: `inviteCount` is the follow-up number — follow-up 1 is sent when `inviteCount` is 1):
```typescript
        await this.safeLogEvent(candidate.name, 'follow_up_sent', String(inviteCount));
```

**(f) phone_no_show and in_person_no_show — in `processInterviewResults`**. In the phone branch:
```typescript
          } else if (phoneResult === 'Failed' || phoneResult === 'No-Show') {
```
after the `updateCandidateStatus(...)` call and before `processed.push(...)`, add:
```typescript
            if (phoneResult === 'No-Show') {
              await this.safeLogEvent(candidate.name, 'phone_no_show');
            }
```
And in the in-person branch:
```typescript
          } else if (inPersonResult === 'Rejected' || inPersonResult === 'No-Show') {
```
after its `updateCandidateStatus(...)` call, add:
```typescript
            if (inPersonResult === 'No-Show') {
              await this.safeLogEvent(candidate.name, 'in_person_no_show');
            }
```

- [ ] **Step 5: Run tests and type-check to verify they pass**

Run: `npm test` — Expected: PASS (all files, all tests).
Run: `npx tsc --noEmit` — Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat: log recruiting events from agent flows"
```

---

### Task 3: Events tab setup script

**Files:**
- Create: `src/scripts/add-events-tab.ts`
- Modify: `package.json` (add script)

**Interfaces:**
- Consumes: `loadConfig` from `src/config.js`, `getGoogleAuth` from `src/google-auth.js`.
- Produces: the `Events` tab that `logEvent` (Task 1), the report (Task 4), and the backfill (Task 5) all use.

This is an I/O-only script following the exact pattern of `src/scripts/add-interview-result-columns.ts`; the repo does not unit-test these scripts. Verification is the type-check.

- [ ] **Step 1: Write the script**

Create `src/scripts/add-events-tab.ts`:

```typescript
// One-time setup: creates the append-only Events tab used by the weekly report.
// Usage: npm run add-events-tab
import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';

const config = loadConfig();
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

console.log(`Fetching spreadsheet metadata for ${spreadsheetId}...`);
const meta = await sheets.spreadsheets.get({ spreadsheetId });
const exists = (meta.data.sheets ?? []).some(s => s.properties?.title === 'Events');
if (exists) {
  console.warn('Events tab already exists — nothing to do (idempotency guard).');
  process.exit(0);
}

await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests: [{ addSheet: { properties: { title: 'Events' } } }] },
});

await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: 'Events!A1:D1',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [['Date', 'Candidate', 'Event', 'Detail']] },
});

console.log('✓ Created Events tab with header row.');
```

- [ ] **Step 2: Add the npm script**

In `package.json`, in `"scripts"`, after the `"add-interview-result-columns"` entry, add:

```json
    "add-events-tab": "npx tsx src/scripts/add-events-tab.ts",
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npm test` — Expected: PASS (nothing broken).
Do NOT run the script against the live spreadsheet during implementation — that is a deployment step.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/add-events-tab.ts package.json
git commit -m "feat: add one-time Events tab setup script"
```

---

### Task 4: Report logic and the weekly-report command

**Files:**
- Create: `src/report.ts`
- Create: `src/scripts/weekly-report.ts`
- Modify: `package.json` (add script)
- Test: `tests/report.test.ts`

**Interfaces:**
- Consumes: the Events tab row shape (`[date, candidate, event, detail]` as `string[][]` from `Events!A2:D`); `SlackService` from `src/adapters/slack.js` (constructor takes the bot token; `post(channel, message)`).
- Produces: `parseReportDate(input: string): string | null`, `countEvents(rows: string[][], startDate: string, endDate: string): EventCounts`, `formatWeeklyReport(counts: EventCounts, startLabel: string, endLabel: string): string`, and `interface EventCounts { applicantsAdded: number; invitesSent: number; followUpsSent: number; phoneNoShows: number; inPersonNoShows: number; hired: number }` — all exported from `src/report.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseReportDate, countEvents, formatWeeklyReport } from '../src/report.js';

describe('parseReportDate', () => {
  it('parses M/D/YYYY into YYYY-MM-DD', () => {
    expect(parseReportDate('7/6/2026')).toBe('2026-07-06');
    expect(parseReportDate('12/25/2026')).toBe('2026-12-25');
  });

  it('accepts already-padded input', () => {
    expect(parseReportDate('07/06/2026')).toBe('2026-07-06');
  });

  it('rejects garbage, wrong separators, and impossible dates', () => {
    expect(parseReportDate('yesterday')).toBeNull();
    expect(parseReportDate('2026-07-06')).toBeNull();
    expect(parseReportDate('13/1/2026')).toBeNull();
    expect(parseReportDate('2/30/2026')).toBeNull();
    expect(parseReportDate('')).toBeNull();
  });
});

describe('countEvents', () => {
  const rows = [
    ['2026-07-05', 'Early Bird', 'applicant_added', ''],
    ['2026-07-06', 'Jane Doe', 'applicant_added', ''],
    ['2026-07-06', 'Jane Doe', 'invite_sent', ''],
    ['2026-07-08', 'Jane Doe', 'follow_up_sent', '1'],
    ['2026-07-10', 'Amy Pond', 'phone_no_show', ''],
    ['2026-07-11', 'Rory Williams', 'in_person_no_show', ''],
    ['2026-07-12', 'River Song', 'hired', ''],
    ['2026-07-12', 'River Song', 'some_future_event', ''],
    ['2026-07-13', 'Late Comer', 'applicant_added', ''],
  ];

  it('counts each event type within the inclusive range', () => {
    const counts = countEvents(rows, '2026-07-06', '2026-07-12');
    expect(counts).toEqual({
      applicantsAdded: 1,
      invitesSent: 1,
      followUpsSent: 1,
      phoneNoShows: 1,
      inPersonNoShows: 1,
      hired: 1,
    });
  });

  it('includes events exactly on the start and end dates', () => {
    const counts = countEvents(rows, '2026-07-05', '2026-07-13');
    expect(counts.applicantsAdded).toBe(3);
  });

  it('ignores unknown event types and malformed rows', () => {
    const counts = countEvents([['', '', '', ''], ['2026-07-06']], '2026-07-01', '2026-07-31');
    expect(counts).toEqual({
      applicantsAdded: 0, invitesSent: 0, followUpsSent: 0,
      phoneNoShows: 0, inPersonNoShows: 0, hired: 0,
    });
  });
});

describe('formatWeeklyReport', () => {
  it('formats all six lines with zeros shown explicitly', () => {
    const text = formatWeeklyReport(
      { applicantsAdded: 12, invitesSent: 8, followUpsSent: 5, phoneNoShows: 2, inPersonNoShows: 1, hired: 0 },
      '7/6/2026',
      '7/12/2026'
    );
    expect(text).toBe([
      '📊 Weekly Recruiting Report: 7/6/2026 – 7/12/2026',
      '• New applicants: 12',
      '• Phone interview invites sent: 8',
      '• Follow-up invites sent: 5',
      '• Phone interview no-shows: 2',
      '• In-person no-shows: 1',
      '• Offers sent (hired): 0',
    ].join('\n'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/report.test.ts`
Expected: FAIL — cannot resolve `../src/report.js`.

- [ ] **Step 3: Implement `src/report.ts`**

```typescript
// Pure logic for the weekly recruiting report. No API calls in this file.

export interface EventCounts {
  applicantsAdded: number;
  invitesSent: number;
  followUpsSent: number;
  phoneNoShows: number;
  inPersonNoShows: number;
  hired: number;
}

// "7/6/2026" → "2026-07-06". Null for anything unparseable or impossible.
export function parseReportDate(input: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// rows: Events!A2:D values — [date, candidate, event, detail]. Range is inclusive.
export function countEvents(rows: string[][], startDate: string, endDate: string): EventCounts {
  const counts: EventCounts = {
    applicantsAdded: 0, invitesSent: 0, followUpsSent: 0,
    phoneNoShows: 0, inPersonNoShows: 0, hired: 0,
  };
  for (const row of rows) {
    const date = (row[0] ?? '').trim();
    const event = (row[2] ?? '').trim();
    if (!date || date < startDate || date > endDate) continue;
    switch (event) {
      case 'applicant_added': counts.applicantsAdded++; break;
      case 'invite_sent': counts.invitesSent++; break;
      case 'follow_up_sent': counts.followUpsSent++; break;
      case 'phone_no_show': counts.phoneNoShows++; break;
      case 'in_person_no_show': counts.inPersonNoShows++; break;
      case 'hired': counts.hired++; break;
      // Unknown event types are ignored for forward compatibility.
    }
  }
  return counts;
}

export function formatWeeklyReport(counts: EventCounts, startLabel: string, endLabel: string): string {
  return [
    `📊 Weekly Recruiting Report: ${startLabel} – ${endLabel}`,
    `• New applicants: ${counts.applicantsAdded}`,
    `• Phone interview invites sent: ${counts.invitesSent}`,
    `• Follow-up invites sent: ${counts.followUpsSent}`,
    `• Phone interview no-shows: ${counts.phoneNoShows}`,
    `• In-person no-shows: ${counts.inPersonNoShows}`,
    `• Offers sent (hired): ${counts.hired}`,
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the command script**

Create `src/scripts/weekly-report.ts`:

```typescript
// Weekly recruiting report: counts events from the Events tab for a date range,
// prints to console, and posts to the recruiting Slack channel.
// Usage: npm run weekly-report -- 7/6/2026 7/12/2026   (both dates inclusive)
import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';
import { SlackService } from '../adapters/slack.js';
import { parseReportDate, countEvents, formatWeeklyReport } from '../report.js';

const usage = 'Usage: npm run weekly-report -- <start M/D/YYYY> <end M/D/YYYY>  (both inclusive)';
const [startArg, endArg] = process.argv.slice(2);
if (!startArg || !endArg) {
  console.error(usage);
  process.exit(1);
}
const startDate = parseReportDate(startArg);
const endDate = parseReportDate(endArg);
if (!startDate || !endDate) {
  console.error(`Could not parse "${!startDate ? startArg : endArg}" as M/D/YYYY.\n${usage}`);
  process.exit(1);
}
if (startDate > endDate) {
  console.error(`Start date ${startArg} is after end date ${endArg}.\n${usage}`);
  process.exit(1);
}

const config = loadConfig();
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

let rows: string[][];
try {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google_sheets.tracker_spreadsheet_id,
    range: 'Events!A2:D',
  });
  rows = (response.data.values ?? []) as string[][];
} catch (err) {
  console.error(`Could not read the Events tab (${err instanceof Error ? err.message : err}).`);
  console.error('If the tab does not exist yet, run: npm run add-events-tab');
  process.exit(1);
}

const report = formatWeeklyReport(countEvents(rows, startDate, endDate), startArg, endArg);
console.log(`\n${report}\n`);

const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) {
  console.error('SLACK_BOT_TOKEN not set in .env — report printed above but NOT posted to Slack.');
  process.exit(1);
}
try {
  await new SlackService(slackToken).post(config.slack.recruiting_channel, report);
  console.log('Report posted to Slack.');
} catch (err) {
  console.error(`Slack post failed — report printed above. ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
```

- [ ] **Step 6: Add the npm script**

In `package.json`, after the `"add-events-tab"` entry, add:

```json
    "weekly-report": "npx tsx src/scripts/weekly-report.ts",
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npm test` — Expected: PASS.
Run: `npm run weekly-report` (no args) — Expected: prints the usage line and exits with code 1. Do not run with real dates (live API).

- [ ] **Step 8: Commit**

```bash
git add src/report.ts src/scripts/weekly-report.ts package.json tests/report.test.ts
git commit -m "feat: add weekly-report command"
```

---

### Task 5: Backfill from local run logs

**Files:**
- Create: `src/backfill.ts`
- Create: `src/scripts/backfill-events.ts`
- Modify: `package.json` (add script)
- Test: `tests/backfill.test.ts`

**Interfaces:**
- Consumes: log files in `logs/` named like `2026-06-08T06-01-41-start.log` / `...-act.log` (the timestamp is a UTC instant); the Events tab from Task 3.
- Produces: `interface BackfillEvent { date: string; candidate: string; event: 'applicant_added' | 'invite_sent' | 'follow_up_sent' | 'hired'; detail: string }`, `dateFromLogFilename(filename: string): string | null`, `reorderFolderName(name: string): string`, `extractEventsFromLog(filename: string, content: string): BackfillEvent[]`, `dedupeEvents(events: BackfillEvent[]): BackfillEvent[]` — all exported from `src/backfill.ts`.

**Context:** these four line patterns exist in the real logs (no-shows are NOT backfilled — that feature shipped 2026-07-13, so no historical data exists):

| Event | Real sample line |
|---|---|
| `applicant_added` | `[Agent] Creating Drive folder: "Bulseco, Tina - 2026-06-08"` |
| `invite_sent` | `[Agent] Setting up interview for AYATULAHI OSMAN...` |
| `follow_up_sent` | `  → Afton Newell — invite #2` (run-summary line; invite #2 = follow-up 1) |
| `hired` | `[Agent] Acting on Audra Long: Hire` |

- [ ] **Step 1: Write the failing tests**

Create `tests/backfill.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { dateFromLogFilename, reorderFolderName, extractEventsFromLog, dedupeEvents } from '../src/backfill.js';

describe('dateFromLogFilename', () => {
  it('extracts the UTC date from start and act log filenames', () => {
    expect(dateFromLogFilename('2026-06-08T06-01-41-start.log')).toBe('2026-06-08');
    expect(dateFromLogFilename('2026-07-01T18-30-00-act.log')).toBe('2026-07-01');
  });

  it('returns null for non-run-log filenames', () => {
    expect(dateFromLogFilename('notes.txt')).toBeNull();
    expect(dateFromLogFilename('2026-06-08-something.log')).toBeNull();
  });
});

describe('reorderFolderName', () => {
  it('reorders "Last, First" to "First Last"', () => {
    expect(reorderFolderName('Bulseco, Tina')).toBe('Tina Bulseco');
  });

  it('splits on the FIRST comma for multi-part last names', () => {
    expect(reorderFolderName('(Morales) Hernandez, Alberta')).toBe('Alberta (Morales) Hernandez');
  });

  it('leaves comma-less names unchanged', () => {
    expect(reorderFolderName('Cher')).toBe('Cher');
  });
});

describe('extractEventsFromLog', () => {
  const FILENAME = '2026-06-08T06-01-41-start.log';

  it('extracts applicant_added from folder-creation lines, preferring the date in the folder name', () => {
    const content = '[Agent] Creating Drive folder: "Bulseco, Tina - 2026-06-07"\n';
    expect(extractEventsFromLog(FILENAME, content)).toEqual([
      { date: '2026-06-07', candidate: 'Tina Bulseco', event: 'applicant_added', detail: '' },
    ]);
  });

  it('extracts invite_sent using the filename date', () => {
    const content = '[Agent] Setting up interview for AYATULAHI OSMAN...\n';
    expect(extractEventsFromLog(FILENAME, content)).toEqual([
      { date: '2026-06-08', candidate: 'AYATULAHI OSMAN', event: 'invite_sent', detail: '' },
    ]);
  });

  it('extracts follow_up_sent from summary lines, mapping invite #N to follow-up N-1', () => {
    const content = '  → Afton Newell — invite #2\n  → Alana Taala — invite #3\n';
    expect(extractEventsFromLog(FILENAME, content)).toEqual([
      { date: '2026-06-08', candidate: 'Afton Newell', event: 'follow_up_sent', detail: '1' },
      { date: '2026-06-08', candidate: 'Alana Taala', event: 'follow_up_sent', detail: '2' },
    ]);
  });

  it('extracts hired from Acting on ... Hire lines (case-insensitive on hire)', () => {
    const content = '[Agent] Acting on Audra Long: Hire\n[Agent] Acting on Jose Gomez: hire\n';
    expect(extractEventsFromLog(FILENAME, content).map(e => e.candidate)).toEqual(['Audra Long', 'Jose Gomez']);
  });

  it('ignores unrelated lines, including other Acting on decisions', () => {
    const content = [
      '[Agent] Acting on Jane Doe: Reject',
      '[Agent] Acting on Amy Pond: Approve',
      '[Indeed] Found candidate: Jane Doe (Sandy, UT) id=abc',
      '[Agent] Moving row to Hired tab...',
    ].join('\n');
    expect(extractEventsFromLog(FILENAME, content)).toEqual([]);
  });

  it('returns nothing for a file whose name is not a run log', () => {
    expect(extractEventsFromLog('notes.txt', '[Agent] Acting on Audra Long: Hire')).toEqual([]);
  });
});

describe('dedupeEvents', () => {
  it('keeps the earliest occurrence per candidate for applicant/invite/hired', () => {
    const result = dedupeEvents([
      { date: '2026-06-10', candidate: 'Jane Doe', event: 'invite_sent', detail: '' },
      { date: '2026-06-08', candidate: 'Jane Doe', event: 'invite_sent', detail: '' },
      { date: '2026-06-09', candidate: 'Amy Pond', event: 'invite_sent', detail: '' },
    ]);
    expect(result).toEqual([
      { date: '2026-06-08', candidate: 'Jane Doe', event: 'invite_sent', detail: '' },
      { date: '2026-06-09', candidate: 'Amy Pond', event: 'invite_sent', detail: '' },
    ]);
  });

  it('dedupes follow-ups per candidate + follow-up number', () => {
    const result = dedupeEvents([
      { date: '2026-06-10', candidate: 'Jane Doe', event: 'follow_up_sent', detail: '1' },
      { date: '2026-06-12', candidate: 'Jane Doe', event: 'follow_up_sent', detail: '1' },
      { date: '2026-06-14', candidate: 'Jane Doe', event: 'follow_up_sent', detail: '2' },
    ]);
    expect(result.map(e => `${e.detail}@${e.date}`)).toEqual(['1@2026-06-10', '2@2026-06-14']);
  });

  it('matches candidates case-insensitively', () => {
    const result = dedupeEvents([
      { date: '2026-06-08', candidate: 'JANE DOE', event: 'hired', detail: '' },
      { date: '2026-06-09', candidate: 'Jane Doe', event: 'hired', detail: '' },
    ]);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backfill.test.ts`
Expected: FAIL — cannot resolve `../src/backfill.js`.

- [ ] **Step 3: Implement `src/backfill.ts`**

```typescript
// Pure log-parsing logic for the one-time Events backfill.
// No filesystem or API calls in this file.

export interface BackfillEvent {
  date: string;      // YYYY-MM-DD
  candidate: string;
  event: 'applicant_added' | 'invite_sent' | 'follow_up_sent' | 'hired';
  detail: string;
}

// "2026-06-08T06-01-41-start.log" → "2026-06-08". This is the UTC date, which
// matches what the live logEvent would have written during that run (today()
// is UTC-based everywhere in this codebase). Null if not a run-log filename.
export function dateFromLogFilename(filename: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}-(?:start|act)\.log$/.exec(filename);
  return m ? m[1] : null;
}

// "Last, First" → "First Last"; splits on the FIRST comma. Comma-less input
// is returned unchanged.
export function reorderFolderName(name: string): string {
  const idx = name.indexOf(', ');
  if (idx === -1) return name;
  return `${name.slice(idx + 2)} ${name.slice(0, idx)}`;
}

const FOLDER_LINE = /^\[Agent\] Creating Drive folder: "(.+) - (\d{4}-\d{2}-\d{2})"$/;
const INVITE_LINE = /^\[Agent\] Setting up interview for (.+)\.\.\.$/;
const FOLLOW_UP_LINE = /^→ (.+) — invite #(\d)$/;
const HIRE_LINE = /^\[Agent\] Acting on (.+): [Hh]ire$/;

export function extractEventsFromLog(filename: string, content: string): BackfillEvent[] {
  const fileDate = dateFromLogFilename(filename);
  if (!fileDate) return [];
  const events: BackfillEvent[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    let m = FOLDER_LINE.exec(line);
    if (m) {
      // The folder name carries the run's own date — prefer it over the filename date.
      events.push({ date: m[2], candidate: reorderFolderName(m[1]), event: 'applicant_added', detail: '' });
      continue;
    }
    m = INVITE_LINE.exec(line);
    if (m) {
      events.push({ date: fileDate, candidate: m[1], event: 'invite_sent', detail: '' });
      continue;
    }
    m = FOLLOW_UP_LINE.exec(line);
    if (m) {
      // Summary line "invite #2" means follow-up 1 (invite #1 was the initial invite).
      events.push({ date: fileDate, candidate: m[1], event: 'follow_up_sent', detail: String(Number(m[2]) - 1) });
      continue;
    }
    m = HIRE_LINE.exec(line);
    if (m) {
      events.push({ date: fileDate, candidate: m[1], event: 'hired', detail: '' });
    }
  }
  return events;
}

// applicant_added / invite_sent / hired: unique per candidate (earliest kept).
// follow_up_sent: unique per candidate + follow-up number (earliest kept).
// Protects against retried runs and reprocessed candidates in multiple logs.
export function dedupeEvents(events: BackfillEvent[]): BackfillEvent[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();
  const result: BackfillEvent[] = [];
  for (const e of sorted) {
    const key = e.event === 'follow_up_sent'
      ? `${e.event}|${e.candidate.toLowerCase()}|${e.detail}`
      : `${e.event}|${e.candidate.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backfill.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the backfill script**

Create `src/scripts/backfill-events.ts`:

```typescript
// One-time backfill: parses logs/*.log and populates the Events tab.
// Refuses to run if the Events tab already has data rows.
// Usage: npm run backfill-events
import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';
import { extractEventsFromLog, dedupeEvents, type BackfillEvent } from '../backfill.js';

const config = loadConfig();
const spreadsheetId = config.google_sheets.tracker_spreadsheet_id;
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

// Safety: only run against an empty Events tab (header row only).
let existingRows: unknown[];
try {
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Events!A2:D' });
  existingRows = existing.data.values ?? [];
} catch (err) {
  console.error(`Could not read the Events tab (${err instanceof Error ? err.message : err}).`);
  console.error('If the tab does not exist yet, run: npm run add-events-tab');
  process.exit(1);
}
if (existingRows.length > 0) {
  console.error(`Events tab already has ${existingRows.length} data row(s) — aborting to prevent a double backfill.`);
  process.exit(1);
}

const logsDir = resolve('logs');
const all: BackfillEvent[] = [];
for (const filename of readdirSync(logsDir).sort()) {
  if (!filename.endsWith('.log')) continue;
  try {
    all.push(...extractEventsFromLog(filename, readFileSync(join(logsDir, filename), 'utf8')));
  } catch (err) {
    console.warn(`Skipping unreadable log file ${filename}: ${err instanceof Error ? err.message : err}`);
  }
}

const events = dedupeEvents(all);
if (events.length === 0) {
  console.log('No events found in logs — nothing to backfill.');
  process.exit(0);
}

await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: 'Events!A:D',
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: events.map(e => [e.date, e.candidate, e.event, e.detail]) },
});

const byType = new Map<string, number>();
for (const e of events) byType.set(e.event, (byType.get(e.event) ?? 0) + 1);
console.log(`✓ Backfilled ${events.length} event(s):`);
for (const [type, count] of [...byType.entries()].sort()) {
  console.log(`  ${type}: ${count}`);
}
```

- [ ] **Step 6: Add the npm script**

In `package.json`, after the `"weekly-report"` entry, add:

```json
    "backfill-events": "npx tsx src/scripts/backfill-events.ts",
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npm test` — Expected: PASS (all test files).
Do NOT run the backfill script against the live spreadsheet during implementation — that is a deployment step.

- [ ] **Step 8: Commit**

```bash
git add src/backfill.ts src/scripts/backfill-events.ts package.json tests/backfill.test.ts
git commit -m "feat: add one-time Events backfill from local run logs"
```

---

## Deployment order (after merge — manual, not part of implementation)

1. `npm run add-events-tab` — creates the tab
2. `npm run backfill-events` — populates history from logs
3. Deploy the code (event logging goes live on the next run)
4. `npm run weekly-report -- 7/6/2026 7/12/2026` — first report
