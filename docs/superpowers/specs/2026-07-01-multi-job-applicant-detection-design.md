# Multi-Job Applicant Detection Design

## Overview

FirstLight posts the same caregiver position across multiple cities. Some candidates apply to all of them. This creates noise: the same person shows up multiple times in the applicant list, and automated processing (screening, scoring, Drive folder creation, interview invites) would run on each duplicate.

This feature detects candidates who have applied to more than one job on the account during the profile page visit, flags them with a new `'Human Review'` status, posts a specific Slack alert explaining why, and skips all automated operations until a human resolves the situation.

---

## Detection

Indeed's applicant detail page includes an activity feed (`data-testid="note-section"`). When a candidate has applied to other jobs on the account, the feed contains a span with text matching:

> "This candidate has applied to N other job(s) on this account"

We detect this on the same page load used to fetch profile text, to avoid a second navigation.

**Interface change:** `IndeedAdapter.fetchProfileText(url): Promise<string>` becomes `fetchProfileData(url): Promise<{ text: string; otherJobCount: number }>`.

- `text` — same profile text as before (screener answers, experience, skills, etc.)
- `otherJobCount` — integer parsed from the activity feed text; `0` if the notice is absent

**IndeedService implementation:** after `waitForSelector('[data-testid="load-complete"]')`, additionally query `[data-testid="note-section"]` for text matching `/This candidate has applied to (\d+) other job/i` and parse the capture group. If the section is absent or the pattern doesn't match, `otherJobCount` is `0`.

---

## Data Model

### CandidateStatus

Add `'Human Review'` to the `CandidateStatus` union:

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
  | 'Human Review';   // new
```

### RunResult

Add `humanReviewFlagged: string[]` to `RunResult` to track which candidates were flagged in each run.

---

## Detection Flow in `evaluateCandidates`

After `fetchProfileData` returns, before any screening or Drive work:

```
if otherJobCount > 0:
  1. Build minimal CandidateRow:
       status = 'Human Review'
       humanDecision = ''
       notes = 'Applied to {N} other job(s) on this account — human review required'
       (all other scored/screened fields left empty)
  2. Add row to Active sheet via sheets.addCandidate('Active', row)
  3. Post Slack alert (see below)
  4. result.humanReviewFlagged.push(applicant.name)
  5. markProcessed(applicant.id)
  6. continue  ← skips Drive folder, resume download, screening, scoring
```

No Drive folder is created. No resume is downloaded. No screening or scoring runs.

### Slack Alert

```
⚠️ *Human review needed:* {Name} has applied to {N} other job(s) on this account. Please review and decide how to proceed.
<{indeedProfileUrl}|View in Indeed>
```

---

## Skip Behavior

No additional skip logic is required — it falls out of existing mechanics:

| Operation | Why it skips Human Review |
|---|---|
| `evaluateCandidates` (future runs) | `getEvaluatedCandidates()` includes all Active rows; the candidate's `indeedId` is already in `evaluatedIds` |
| `processFollowUps` | Filters on `status === 'Screened - Invite Sent'` — Human Review never matches |
| `processPendingDecisions` | Only acts when `humanDecision` has a non-empty, non-'none' value; the row is written with `humanDecision = ''` |

**Unblocking:** A human resolves a Human Review candidate by setting `humanDecision` to any valid value (`Approve`, `Reject`, `Hire`, etc.). The existing `processPendingDecisions` flow handles it from there, with no special cases needed.

---

## Changed Files

| File | Change |
|---|---|
| `src/types.ts` | Add `'Human Review'` to `CandidateStatus`; add `humanReviewFlagged: string[]` to `RunResult`; rename `fetchProfileText` → `fetchProfileData` in `IndeedAdapter` |
| `src/adapters/indeed.ts` | Rename method; read note section on same page load |
| `src/fakes/indeed.fake.ts` | Rename method; add `multiJobApplicantIds: Set<string>` seed for tests |
| `src/agent.ts` | Call `fetchProfileData`; add multi-job branch before screening |

---

## Testing

- Multi-job candidate is added to Active with `status = 'Human Review'`
- Multi-job candidate row has the correct `notes` string mentioning the job count
- Slack message contains the candidate's name and job count
- No Drive folder created, no sentiment marked, no interview set up for multi-job candidate
- Normal candidate (`otherJobCount = 0`) still goes through full pipeline unchanged
- `processFollowUps` does not process a `'Human Review'` candidate
- `processPendingDecisions` acts normally on a `'Human Review'` candidate when a human sets `humanDecision`
- `RunResult.humanReviewFlagged` contains the flagged candidate's name
