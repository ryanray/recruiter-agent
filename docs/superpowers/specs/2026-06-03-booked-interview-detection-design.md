# Booked Interview Detection Design

## Goal

Detect when candidates have booked an interview on Indeed and update their status in Sheets, stamp `lastContact`, and post a Slack alert. Runs as part of `npm run act` after `processPendingDecisions`.

---

## What Changes

### Modified
- `src/types.ts` — `Interview` type: remove `indeedInterviewId`, change `scheduledAt: Date` → `scheduledAt: string`
- `src/adapters/indeed.ts` — rewrite `getBookedInterviews()` with real selectors and paginated click-per-card flow
- `src/agent.ts` — add `processBookedInterviews()` method
- `src/run-act.ts` — call `agent.processBookedInterviews()` after `processPendingDecisions()`
- `tests/pipeline.test.ts` — add tests for `processBookedInterviews()`

### Unchanged
- `src/fakes/indeed.fake.ts` — `seedInterviews()` and `getBookedInterviews()` already work correctly
- `SheetsAdapter` — `getActiveCandidates()` already exists and is sufficient
- Drive folders — not moved on interview booking

---

## `Interview` Type (updated)

```typescript
export interface Interview {
  applicantId: string;
  applicantName: string;
  scheduledAt: string; // raw text from Indeed, e.g. "Thursday, June 4, 2026 from 10:45 to 11 am (MDT)"
}
```

`indeedInterviewId` is removed — it is not exposed on Indeed's interview list page.

---

## `getBookedInterviews()` Browser Flow

**URL:** `https://employers.indeed.com/interviews/upcoming`

**Selectors:**
- List container: `[data-testid="interviewList"]`
- Each card: `[data-testid="InterviewCard-Wrapper"]`
- Candidate name on card: `[data-testid="interview-card-candidate"]`
- Details pane applicant link: `[data-testid="CandidateDetails-viewCandidateLink"]` — href is `/candidates/view?id=<applicantId>`
- Interview time: `[data-testid="interviewDetails-datetime"]` — raw text string
- Pagination container: `[data-testid="interviewList-ListPagination"]`
  - First button (index 0): Previous
  - Second button (index 1): Next
  - Either button may be `disabled`

**Per-page flow:**
1. Wait for `[data-testid="interviewList"]`
2. Get all `[data-testid="InterviewCard-Wrapper"]` elements
3. For each card:
   a. Click `[data-testid="interview-card-candidate"]`
   b. Wait for `[data-testid="CandidateDetails-viewCandidateLink"]` to appear
   c. Extract `applicantId` from the link's `href` (`/candidates/view?id=<id>` → `<id>`)
   d. Read `applicantName` from the card's `[data-testid="interview-card-candidate"]` text
   e. Read `scheduledAt` text from `[data-testid="interviewDetails-datetime"]`
   f. Jitter between cards
4. After processing all cards on the page, find the pagination container
5. Get its two buttons; if the Next button (index 1) is not disabled, click it and repeat from step 1
6. If Next is disabled, return all collected interviews

---

## `processBookedInterviews()` — Agent Method

```typescript
async processBookedInterviews(): Promise<void>
```

**Logic:**
1. Call `this.indeed.getBookedInterviews()` — returns all upcoming interviews across all pages
2. Call `this.sheets.getActiveCandidates()` — returns all rows in the Active tab
3. Build a map of `indeedId → CandidateRow` from the active candidates
4. For each interview:
   - Look up the candidate by `interview.applicantId`
   - If no match: log and skip (interview may be from outside this agent's scope)
   - If status is already `Interview Scheduled`: skip (already processed)
   - Update status → `Interview Scheduled`, `lastContact` → today
   - Post Slack alert: `🗓 *Interview scheduled:* <name> — <scheduledAt>`
5. Log a summary of how many interviews were detected and processed

---

## Approve Flow (unchanged)

The existing `processPendingDecisions` approve flow is not affected. `Interview Scheduled` is only set by `processBookedInterviews`.

---

## `run-act.ts` (updated call order)

```
1. processPendingDecisions()   — act on humanDecision values
2. processBookedInterviews()   — detect newly booked interviews
```

---

## Spreadsheet

No new columns. Existing columns cover the state:

| Status | Meaning |
|---|---|
| `Screened - Invite Sent` | Interview request sent, waiting for candidate to book |
| `Interview Scheduled` | Candidate booked a time |

---

## FakeIndeedAdapter

No changes needed. `seedInterviews(interviews)` and `getBookedInterviews()` are already implemented correctly and will work with the updated `Interview` type (just drop `indeedInterviewId` from test fixtures).

---

## Tests

New tests in `tests/pipeline.test.ts` under `Agent.processBookedInterviews`:

1. **Detects a booked interview and updates status + lastContact + posts Slack**
   - Seed one interview matching an Active candidate at `Screened - Invite Sent`
   - Assert status updated to `Interview Scheduled`, `lastContact` set, Slack message posted with name and time

2. **Skips candidate already at `Interview Scheduled`**
   - Seed one interview matching a candidate already at `Interview Scheduled`
   - Assert no status update and no Slack message

3. **Skips interview with no matching candidate**
   - Seed one interview with an `applicantId` not in the Active sheet
   - Assert no updates, no errors

4. **Processes multiple pages** (via multiple seeded interviews across different candidates)
   - Seed two interviews, two matching candidates
   - Assert both are updated

---

## What Does NOT Change

- `markSentiment`, `setupInterview`, `downloadResume`, `fetchProfileText`, `getNewApplications` — unchanged
- Drive folder moves — not triggered by interview booking
- Rejected and Checkback Later flows — unchanged
- `processedIds` / `state.json` — not involved
