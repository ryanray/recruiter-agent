# Follow-Up Invites Feature — Design Spec

**Date:** 2026-06-28
**Status:** Approved

---

## Problem

Candidates who receive an interview invite often don't respond. Currently there is no automated follow-up — they sit in `Screened - Invite Sent` indefinitely. This wastes pipeline capacity and misses candidates who simply needed a second nudge.

---

## Goal

Automatically send up to 2 follow-up invites to non-responding candidates, spaced by a configurable number of days. After 3 total invites with no response, move the candidate to a "Never Responded" tab and Drive folder to keep the Active list clean.

---

## Architecture

A new `processFollowUps()` method on `Agent` handles all follow-up logic. It is called from `run-act.ts` after the existing `processPendingDecisions()` and `processBookedInterviews()` calls. No new entry point or script is needed.

```
run-act.ts
  → agent.processPendingDecisions()    (existing)
  → agent.processBookedInterviews()    (existing)
  → agent.processFollowUps()           (new)
```

`processFollowUps()`:
1. Reads all `Screened - Invite Sent` candidates from the Active sheet
2. For each candidate:
   - Parse `inviteCount` as a number (default `1` if missing — existing candidates already received one invite)
   - Compare `lastContact` to today — if fewer than `follow_up_days` days have passed, skip
   - If `inviteCount === 1` → send follow-up 1, set `inviteCount = "2"`, update `lastContact`
   - If `inviteCount === 2` → send follow-up 2, set `inviteCount = "3"`, update `lastContact`
   - If `inviteCount >= 3` → move Drive folder to `never_responded_folder_id`, move row to Never Responded tab
3. Per-candidate try/catch — a failure logs and continues, never crashes the run

Follow-ups reuse the existing `IndeedAdapter.setupInterview()` method with the configured follow-up message. No new Indeed integration needed.

No Slack notifications are sent for follow-ups. Console logging follows the existing `[Agent]` prefix pattern.

---

## Data Model

### New `CandidateRow` field

```ts
inviteCount?: string;  // "1", "2", "3" — stored as string in sheet
```

Appended as column X (after `interviewScheduledAt` at W). Default `"1"` when missing.

### New `CandidateStatus`

```ts
'Never Responded'
```

Added to the `CandidateStatus` union in `types.ts`.

### New `RunResult` fields

```ts
followUpsSent: { name: string; inviteCount: number }[];
neverResponded: string[];
```

Surfaced in the `formatRunLog` console summary.

### Sheet column order (A–X)

| Col | Field |
|-----|-------|
| A–W | (existing — unchanged) |
| X | inviteCount |

New "Never Responded" tab added to the spreadsheet (created manually or via migration script).

### Config additions

**`config.yaml` — `scheduling` section:**
```yaml
scheduling:
  follow_up_days: 3
```

**`config.yaml` — `messages` section:**
```yaml
messages:
  interview_follow_up_1: "Hi {FIRST_NAME}, ..."
  interview_follow_up_2: "Hi {FIRST_NAME}, ..."
```

**`config.yaml` — `google_drive` section:**
```yaml
google_drive:
  never_responded_folder_id: "..."
```

### `Config` type additions (`src/types.ts`)

```ts
scheduling: {
  follow_up_days: number;
  ...
}

messages: {
  interview_request: string;
  interview_follow_up_1: string;
  interview_follow_up_2: string;
}

google_drive: {
  never_responded_folder_id: string;
  ...
}
```

---

## Error Handling

| Failure | Behavior |
|---------|----------|
| `setupInterview` throws | Log error, skip candidate, continue loop |
| Sheet update fails | Log error, skip candidate, continue loop |
| Drive move fails | Log error, skip candidate, continue loop |
| `inviteCount` missing or unparseable | Default to `1` |
| `lastContact` missing or unparseable | Skip candidate, log warning |

---

## Console Logging

Follow the existing `[Agent]` prefix pattern:

```
[Agent] Checking for candidates needing follow-up...
[Agent] 3 candidate(s) at Screened - Invite Sent.
[Agent] Jane Doe — last contact 5 days ago, inviteCount=1 — sending follow-up 1.
[Agent] John Smith — last contact 2 days ago — too soon, skipping.
[Agent] Alice Brown — inviteCount=3 — no response after 3 invites, moving to Never Responded.
```

---

## Run Summary (`formatRunLog`)

New sections appended to the end-of-run console output:

```
FOLLOW-UPS SENT (2)
  → Jane Doe — invite #2
  → Bob Jones — invite #3

NEVER RESPONDED (1)
  → Alice Brown — moved after 3 unanswered invites
```

---

## Testing

New tests in `tests/pipeline.test.ts` under a `Agent.processFollowUps` describe block:

- Sends follow-up 1 when `inviteCount=1` and past threshold
- Sends follow-up 2 when `inviteCount=2` and past threshold
- Skips candidate when within `follow_up_days` window
- Uses `interview_follow_up_1` message for first follow-up, `interview_follow_up_2` for second
- Moves to Never Responded when `inviteCount=3` and past threshold (Drive move + tab move)
- Does not move to Never Responded when `inviteCount=3` but within threshold
- Defaults `inviteCount` to `1` when field is missing
- Logs and continues when `setupInterview` throws for one candidate

---

## Migration

Run `npm run add-score-columns` (now a general header sync script) to add the `inviteCount` header at column X on Active, Rejected, and Checkback Later tabs. The "Never Responded" tab must be created manually in the spreadsheet before first use (or via an updated migration script).

Existing `Screened - Invite Sent` candidates with no `inviteCount` will be treated as `inviteCount=1` — they will receive follow-up 1 on the next act run if they are past the `follow_up_days` threshold.
