# Batched Slack Notifications — Design

**Date:** 2026-07-22
**Status:** Approved

## Problem

Both agent runs post individual Slack messages per candidate as events occur
(human review flags, holds, interview bookings, hire-flow alerts), then post an
aggregated end-of-run summary. The channel gets noisy: a single run can produce
half a dozen messages, most of which repeat what the summary says — except the
individual messages carry links (Indeed profile, Drive folder, offer sheet) and
the summary does not.

## Goal

Each run posts **exactly one** Slack message: the end-of-run summary, enriched
with the links the individual messages used to carry. Console/file logging is
unchanged — the play-by-play stays in the run logs.

## Approach

Enrich the run-result data structures and render links in the existing summary
formatters. The agent methods stop calling `slack.post` mid-run and instead
return richer objects (URLs, reasons) in the result arrays they already return.
This fits the existing "collect results, format one summary" architecture; the
mid-run posts were the anomaly.

Rejected alternative: a deferred/buffering mode in `SlackService` that flushes
queued messages as one combined post. Less churn, but the output would be the
old messages concatenated on top of the summary — redundant, and links would
not land in the summary sections where they belong.

## Inline posts removed

### Sense/evaluate run (`processNewApplicants`, 3 posts)

| Current post | Replacement |
|---|---|
| ⚠️ Human review needed (multi-job applicant) | Entry in widened `humanReviewFlagged` |
| ⚠️ Previously contacted | Entry in new `previouslyContacted` array |
| ❓ Review needed (unsure) | Already in `unsure`; entries gain `indeedUrl` |

### Act run (5 posts)

| Current post | Replacement |
|---|---|
| 🗓 Interview scheduled (`processBookedInterviews`) | `newlyBooked` entries gain `score`, `tier`, `indeedUrl`, `driveFolder` |
| 🚩 Hold for review (`processPendingDecisions`) | New `holds` array |
| @here missing interview-questions sheet (hire flow) | Entry in new `actionRequired` array |
| @here missing offer info (hire flow) | Entry in new `actionRequired` array (keeps sheet link) |
| ⚠️ Human review needed (multi-job, `processFollowUps`) | Widened `humanReviewFlagged` |

## Data-shape changes (`src/types.ts` and method returns)

- `RunResult.humanReviewFlagged`: `string[]` → `{ name, otherJobCount, indeedUrl }[]`
  (used by both runs).
- `RunResult.previouslyContacted` (new): `{ name, lastSeen, indeedUrl }[]`.
- `RunCandidateResult` (unsure entries): add `indeedUrl`.
- `processBookedInterviews` → `newlyBooked`: `{ name, scheduledAt, score?, tier?, indeedUrl, driveFolder? }[]`.
- `processPendingDecisions` → adds `holds: { name, agentRecommendation, notes, indeedUrl }[]`
  and `actionRequired: { name, issue, link? }[]`.

## Summary rendering (`src/logger.ts`)

Slack link syntax `<url|label>` throughout.

**Act summary (`formatActSummary`)** — section order:

1. **🚨 Action required** — only when `actionRequired` is non-empty; the message
   then *starts* with `<!here>`. One line per item:
   `• Name — missing offer info (start date, rate)  <sheet-url|Open sheet>`
2. Decisions processed (unchanged)
3. Interviews booked:
   `• Name — 2026-07-24 10:00  |  82/100 (A)  |  <…|Indeed>  |  <…|Drive>`
   (score/Drive segments omitted when absent)
4. 🚩 Held for review (new): `• Name — Agent: <recommendation> — <notes>  <…|Indeed>`
5. Interview results actioned, in-person reminders, follow-ups, never responded
   (unchanged)
6. Flagged for human review:
   `• Name — applied to N other job(s)  <…|Indeed>`

**Evaluate summary (`formatCandidateSummary`)**:

- Unsure lines gain `<…|View in Indeed>`.
- Flagged-for-human-review lines gain other-job count and `<…|View in Indeed>`.
- New "Previously contacted" section: `• Name — last seen 2026-05-01  <…|View in Indeed>`.

## Bug fix included

The current hire-flow alerts send literal `@here` text, which does **not**
trigger a notification via `chat.postMessage`. The batched summary uses the
working mrkdwn form `<!here>`.

## Non-goals / notes

- No pagination or message-splitting: runs touch a handful of candidates;
  Slack's ~40k-char text limit is not a realistic concern.
- No changes to console/file logging or the plain-text run report formatter
  beyond what the widened types force.
- `SlackService` is untouched.

## Testing

Existing fakes capture Slack posts. Tests assert:

- Exactly one Slack post per run (sense and act), covering paths that
  previously posted inline (multi-job flag, hold, booking, hire-flow gaps).
- Summary text spot-checks: links render in booked/flagged/unsure lines;
  `<!here>` + Action-required section appear only when `actionRequired` is
  non-empty.
