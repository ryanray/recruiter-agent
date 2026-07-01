# Hire Candidate Feature — Design Spec

**Date:** 2026-07-01
**Status:** Approved

---

## Problem

When a hiring decision is made for a candidate who has completed an interview, there is no automated workflow to move them from the recruiting pipeline into the employee onboarding process. Steps must be done manually across Indeed, Google Drive, two Google Sheets, and Slack.

---

## Goal

When a recruiter sets `humanDecision = "Hire"` on a candidate in the Active sheet and runs `npm run act`, the agent automatically:

1. Moves their Drive folder to the Active Employees folder
2. Validates the Offer Info tab in their interview questions sheet — alerts Slack if anything is missing
3. Sets their Indeed status to "Hired"
4. Moves their row from Active → Hired tab with status `Onboarding`
5. Appends them to the Tracker tab with name, status, and start date

---

## Architecture

The `"Hire"` decision is handled inside `processPendingDecisions()` as a new branch alongside Approve, Reject, Checkback Later, and Hold. No new entry point or script is needed.

```
processPendingDecisions()
  → "hire" branch
      1. move Drive folder → active_employees_folder_id
      2. find interview questions sheet in folder
         → read 'Offer Info'!B2:B7
         → validate required fields
         → if missing: post Slack @here alert (non-blocking — hire continues)
      3. indeed.setStatus(indeedId, 'Hired')      ← generic, reusable
      4. sheets.moveCandidate('Active' → 'Hired'), status = 'Onboarding'
      5. sheets.addToTracker(lastName, firstName, startDate)
```

Missing offer info posts a Slack alert but does **not** block the hire — the candidate is hired regardless, and the alert gives someone a chance to complete the sheet.

A per-candidate try/catch wraps the whole branch. One hire failing does not affect others.

---

## Data Model

### New `CandidateStatus` value

```ts
'Onboarding'
```

Added to the `CandidateStatus` union in `types.ts`.

### New `OfferInfo` type

```ts
interface OfferInfo {
  email: string;       // B2
  cellPhone: string;   // B3
  startDate: string;   // B4
  rateOffered: string; // B6
  justification: string; // B7 — required only if rateOffered > 16
}
```

### New config field

```yaml
google_drive:
  active_employees_folder_id: "..."
```

Added to `Config.google_drive` and `REQUIRED_FIELDS` in `config.ts`.

### Existing sheets used

- **Active tab** — source of hire candidates (existing)
- **Hired tab** — destination for hired candidates (create manually; same recruiter spreadsheet)
- **Tracker tab** — employee tracker in same recruiter spreadsheet; columns A=Last Name, B=First Name, C=Status, D=Start Date

---

## New Methods

### `IndeedAdapter.setStatus`

```ts
setStatus(applicantId: string, status: string): Promise<void>
```

Generic — reusable for any Indeed status value beyond Hired. Implemented in `IndeedService` via Playwright:

1. Navigate to `https://employers.indeed.com/candidates/view?id={applicantId}`
2. Wait for `[data-testid="load-complete"]`
3. Click `[data-testid="Status-Menu"]`
4. Wait for `[role="listbox"]` to appear
5. Find `[role="option"]` whose inner `<span>` text matches `status` (case-insensitive)
6. Click the matching option
7. Wait for listbox to disappear (confirms selection)

### `DriveAdapter.findSpreadsheetInFolder`

```ts
findSpreadsheetInFolder(folderId: string): Promise<{ id: string; name: string } | null>
```

Lists files in the folder with `mimeType = 'application/vnd.google-apps.spreadsheet'`. Returns the first match, or `null` if none found.

### `SheetsAdapter.readOfferInfo`

```ts
readOfferInfo(spreadsheetId: string): Promise<OfferInfo>
```

Reads `'Offer Info'!B2:B7` from the given spreadsheet ID (the candidate's interview questions file — not the recruiter tracker). Uses the same Google Auth as `SheetsService`. Returns an `OfferInfo` with empty strings for any missing cells.

### `SheetsAdapter.addToTracker`

```ts
addToTracker(lastName: string, firstName: string, startDate: string): Promise<void>
```

Appends one row to the `Tracker` tab of the recruiter spreadsheet:

| A | B | C | D |
|---|---|---|---|
| lastName | firstName | `'Onboarding'` | startDate |

---

## Offer Info Validation

Required fields (must be non-empty): `email`, `cellPhone`, `startDate`, `rateOffered`

Conditionally required: `justification` is required when `parseFloat(rateOffered) > 16`

If any required field is missing, post to `config.slack.recruiting_channel`:

```
@here Action required: missing offer info for Jane Doe. <https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit|Click here>
```

Links to the spreadsheet root (not a specific tab — avoids an extra API call to resolve the tab GID).

---

## Error Handling

| Failure | Behavior |
|---|---|
| `driveFolder` missing from candidate row | Log warning, skip folder move, continue |
| No spreadsheet found in folder | Log warning, post Slack alert (sheet not found), continue |
| Offer info fields missing or blank | Post Slack `@here` alert listing missing fields, continue |
| Rate > 16 but no justification | Included in Slack alert as a missing field |
| `setStatus` (Indeed) throws | Log error, continue with sheet/tracker steps |
| `moveCandidate` to Hired throws | Log error, stop this candidate (don't write Tracker with inconsistent state) |
| `addToTracker` throws | Log error with candidate name so it can be manually added |
| Candidate not found on Active tab | `moveCandidate` is a no-op — logs and continues |

---

## Name Parsing

Candidate names in the sheet are stored as `"Last, First"` (e.g. `"Ray, Ryan"`). Split on `", "` to get `lastName` and `firstName` for the Tracker row.

---

## Console Logging

Follows the existing `[Agent]` prefix pattern:

```
[Agent] Acting on Jane Doe: Hire
[Agent] Moving Drive folder to Active Employees...
[Agent] Finding interview questions sheet in folder...
[Agent] Reading Offer Info tab...
[Agent] Offer info valid — start date: 2026-07-15, rate: $15/hr
[Agent] Setting Indeed status to Hired...
[Agent] Moving row to Hired tab...
[Agent] Adding Jane Doe to Tracker...
[Agent] Done acting on Jane Doe.
```

---

## Testing

New tests in `tests/pipeline.test.ts` under `describe('Agent — hire decision')`:

- Full happy path: folder moved, offer info valid, Indeed status set, row moved to Hired, Tracker row appended
- Missing offer info fields: Slack `@here` alert posted, hire still completes
- Rate > 16 with no justification: Slack alert lists justification as missing
- No spreadsheet found in folder: Slack alert about missing sheet, hire still completes
- `setStatus` throws: error logged, hire continues (row moved, Tracker written)
- `moveCandidate` throws: error logged, `addToTracker` not called

---

## Migration

1. Create a `Hired` tab in the recruiter spreadsheet manually (same column layout as Active, A–X)
2. Add `active_employees_folder_id` to `config.yaml` with the real Google Drive folder ID
3. Ensure the `Tracker` tab exists in the recruiter spreadsheet with headers in row 1

No schema migration needed — no new columns on the Active sheet.

---

## Future Extension Points

The `setStatus` method on `IndeedAdapter` is intentionally generic. Future steps (WellSky, Viventium, BeeTexting integrations) can be added as additional sequential steps inside the `'hire'` branch without changing its overall structure.
