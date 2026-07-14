# Weekly Recruiting Report — Design

**Date:** 2026-07-14
**Status:** Approved pending user review

## Goal

A `weekly-report` command that, given a start and end date, reports six weekly
recruiting metrics to the console and the recruiting Slack channel:

1. Total new applicants
2. Phone interview invites sent (initial invites only, not follow-ups)
3. Follow-up invites sent
4. Phone interview no-shows
5. In-person interview no-shows
6. Offers sent (candidates moved to Hired)

## Background

Four of the six metrics cannot be computed from the current tracker columns
because no event dates exist for them (`lastContact` is overwritten by later
events; no-show results and hires carry no timestamps). The chosen approach is
an append-only **Events tab** in the tracker spreadsheet: Chandler logs one row
per reportable event as it happens, and the report counts rows in the date
range. A one-time **backfill script** parses the local `logs/` folder to
populate events back to early June 2026.

## 1. Events tab

New tab named `Events` in the tracker spreadsheet
(`google_sheets.tracker_spreadsheet_id`). Append-only; humans never edit it.

| Column | Header | Format | Example |
|---|---|---|---|
| A | Date | `YYYY-MM-DD` | `2026-07-14` |
| B | Candidate | Full name as it appears on candidate rows | `Maria Garcia` |
| C | Event | One of the event types below | `follow_up_sent` |
| D | Detail | Optional context | `2` (follow-up number) |

**Event types:**

| Event | Detail | Written when |
|---|---|---|
| `applicant_added` | — | A new candidate row is created (both intake paths in `agent.ts`) |
| `invite_sent` | — | Initial phone-interview invite sent (`processScreened`) |
| `follow_up_sent` | follow-up number (`1` or `2`) | Follow-up invite sent (`processFollowUps`) |
| `phone_no_show` | — | `processInterviewResults` handles `phoneInterviewResult = No-Show` |
| `in_person_no_show` | — | `processInterviewResults` handles `inPersonInterviewResult = No-Show` |
| `hired` | — | Candidate row moved to the Hired tab (`processPendingDecisions` hire path) |

**Setup:** one-time script `src/scripts/add-events-tab.ts`
(`npm run add-events-tab`) creates the tab with the header row. Idempotent: if
a tab named `Events` already exists, it warns and exits without changes
(same pattern as `add-interview-result-columns.ts`).

## 2. Event logging in Chandler

New method on the sheets adapter (`src/adapters/sheets.ts`):

```typescript
async logEvent(candidate: string, event: string, detail?: string): Promise<void>
```

Appends one row to `Events!A:D` with today's date (same local-date helper the
adapter already uses). Added to the `SheetsAdapter` interface in
`src/types.ts`.

Call sites in `src/agent.ts` (six total, matching the event table above). Every
call is wrapped so a logging failure can never break a run: catch, log a
console warning, continue. Event logging is fire-and-forget bookkeeping —
the candidate action always takes precedence.

Ordering rule: log the event **after** the action it records succeeds, so a
failed action does not produce a phantom event.

## 3. Report command

`src/scripts/weekly-report.ts`, run as:

```bash
npm run weekly-report -- 7/6/2026 7/12/2026
```

- **Inputs:** start date and end date, `M/D/YYYY` format, both inclusive.
- Reads all rows from `Events!A:D`, filters to rows whose date falls in the
  range, counts by event type.
- **Output** (printed to console first, then posted to the recruiting Slack
  channel):

```
📊 Weekly Recruiting Report: 7/6/2026 – 7/12/2026
• New applicants: 12
• Phone interview invites sent: 8
• Follow-up invites sent: 5
• Phone interview no-shows: 2
• In-person no-shows: 1
• Offers sent (hired): 1
```

- Zero counts print as `0`, never omitted.
- Unknown event types in the tab are ignored (forward compatibility).

## 4. Backfill script (one-time)

`src/scripts/backfill-events.ts` (`npm run backfill-events`) populates the
Events tab from the local run logs in `logs/`.

**Safety:** refuses to run if the Events tab contains any data rows (only the
header may be present). This makes double-backfill impossible.

**Parsing:** for each `logs/*.log` file:

- Event date = the UTC date from the log filename
  (`2026-06-08T06-01-41-start.log` → `2026-06-08`). This matches what the live
  `logEvent` would have written during that run, since the codebase's `today()`
  helper is UTC-based (`toISOString().slice(0, 10)`).
- Extracted events:

| Event | Line pattern | Name extraction |
|---|---|---|
| `applicant_added` | `[Agent] Creating Drive folder: "Last, First - YYYY-MM-DD"` | Reorder `Last, First` → `First Last`; date inside the quoted folder name wins over the filename date |
| `invite_sent` | `[Agent] Setting up interview for NAME...` | Text between `for ` and trailing `...` |
| `follow_up_sent` | `→ NAME — invite #N` (run-summary lines, N = 2 or 3) | Text between `→ ` and ` — invite`; detail = N − 1 (invite #2 is follow-up 1) |
| `hired` | `[Agent] Acting on NAME: Hire` | Text between `Acting on ` and `: Hire` (case-insensitive on `Hire`) |

No-show events are not backfilled — the interview-result columns shipped
2026-07-13, so no historical no-show data exists and zero is accurate.

**Dedup rules** (protects against retried runs and reprocessed candidates
appearing in multiple logs):

- `applicant_added`, `invite_sent`, `hired`: unique per candidate; keep the
  earliest occurrence.
- `follow_up_sent`: unique per candidate + follow-up number; keep the earliest.

Rows are sorted by date, then appended to the Events tab in one batch. The
script prints a per-event-type count summary when done.

**Known limitations (accepted):**

- A log line records that Chandler *attempted* an action; if a run crashed
  mid-candidate, the event may not have completed. Rare, acceptable for a
  weekly ops report.
- Only runs executed from this machine have local logs; runs from elsewhere
  (if any) are missing.
- Name reordering of `"Last, First"` folder names is heuristic for multi-word
  names; candidate names in backfilled `applicant_added` events may
  occasionally differ from the sheet's spelling. The report only counts
  events, so this does not affect the numbers.

## 5. Error handling

- **Report command:** missing arguments, unparseable dates, or start > end →
  print a usage message and exit 1. Events tab missing → clear error telling
  the user to run `npm run add-events-tab`. Console output prints before the
  Slack post, so a Slack failure still leaves the report visible locally
  (warn and exit 1).
- **Event logging:** never fatal; catch, warn, continue (see section 2).
- **Backfill:** unreadable log file → warn and skip that file; any data rows
  already in the Events tab → abort with a message.

## 6. Testing

- **Report logic:** extract filtering/counting/formatting into pure functions;
  unit-test date parsing (valid, invalid, start > end), range inclusivity
  (events on the start and end dates count), counting by type, zero counts,
  and unknown-event-type tolerance.
- **Event logging:** extend the mock sheets adapter in `tests/pipeline.test.ts`
  with `logEvent`; assert each of the six flows logs the right event type and
  detail, and that a throwing `logEvent` does not break the flow.
- **Backfill parsing:** unit-test each line pattern against real sample lines
  from the logs (including `Last, First` reordering and the `— invite #N` → 
  follow-up-number mapping) and the dedup rules against duplicated input.

## Out of scope (YAGNI)

- No changes to existing report-adjacent features (run log doc, run
  summaries).
- No retroactive no-show reconstruction.
- No scheduling/cron for the report — it is run manually once a week.
- No new columns on candidate rows.
