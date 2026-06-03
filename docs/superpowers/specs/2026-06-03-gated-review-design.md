# Gated Human Review Design

## Goal

Add a human-in-the-loop approval step between agent evaluation and agent action. The agent evaluates candidates and surfaces recommendations; a human reviews and decides; the agent then acts on confirmed decisions.

## Architecture

The agent has two distinct operations that can be run together or independently:

- **Evaluate** (`npm run candidates`) — scrapes Indeed, screens candidates, creates Drive folders, writes to Sheets. No Indeed actions taken.
- **Act** (`npm run act`) — reads Sheets for rows with a human decision, executes the corresponding Indeed/Drive/Sheets actions.
- **`npm start`** — runs Evaluate then Act in sequence.

---

## Evaluate Flow

1. Load all `indeedId` values from Active and Rejected tabs in Sheets (deduplication list).
2. Scrape Indeed candidate listing. Skip candidates with sentiment already marked. Skip candidates whose `indeedId` is already in Sheets.
3. Slice to `max_candidates_per_run`.
4. For each new candidate:
   - Fetch profile text from detail page.
   - Get driving distance from Google Maps Distance Matrix API.
   - Screen with Claude → `PASS`, `FAIL`, or `UNSURE` + reasons.
   - Create a Drive folder inside "Awaiting Automation Action": `Last, First - YYYY-MM-DD`.
   - Download resume → upload to folder as `resume.pdf`.
   - Copy interview questions template into folder.
   - Write row to Active tab with:
     - `status`: `Awaiting Review`
     - `agentRecommendation`: `PASS`, `FAIL`, or `UNSURE`
     - `notes`: screening reasons + distance
     - `driveFolder`: link to the folder in Awaiting Automation Action
     - `indeedId`: raw Indeed candidate ID
     - `humanDecision`: blank
   - Mark candidate ID as processed in `state.json` (crash recovery).

---

## Act Flow

1. Read Active tab from Sheets. Find all rows where `humanDecision` is non-empty.
2. For each actioned row:

**Approve**
- Send intro message on Indeed (`messages.intro`).
- Trigger phone screen scheduler on Indeed (with `hiring_team_emails`).
- Move Drive folder from "Awaiting Automation Action" → recruiting root folder.
- Update row: `status` → `Screened - Invite Sent`, clear `humanDecision`.

**Reject**
- Send rejection message on Indeed (`messages.rejection`).
- Move Drive folder from "Awaiting Automation Action" → `_Rejected` folder.
- Append row to Rejected tab, delete row from Active tab.

**Checkback Later**
- Move Drive folder from "Awaiting Automation Action" → `_Checkback Later` folder.
- Append row to Checkback Later tab, delete row from Active tab.

**Hold**
- Post Slack alert to `recruiting_channel`: candidate name + profile URL + agent recommendation.
- No folder move.
- Clear `humanDecision` cell so the row doesn't re-trigger on the next Act run.

---

## Spreadsheet Columns

All tabs that hold candidate rows gain three new columns:

| Column | Set by | Values |
|---|---|---|
| `indeedId` | Agent | Raw Indeed candidate ID (e.g. `ae55ab28216b`) |
| `agentRecommendation` | Agent | `PASS`, `FAIL`, or `UNSURE` |
| `humanDecision` | Human | `Approve`, `Reject`, `Checkback Later`, `Hold`, or blank |

The `notes` column holds the agent's reasoning (distance in miles, screening flags).
The `driveFolder` column holds the link to the candidate folder so reviewers can click through to the resume and interview questions.

Full column order (Active and Rejected tabs):
`name`, `phone`, `email`, `indeedUrl`, `indeedId`, `location`, `experience`, `certifications`, `agentRecommendation`, `status`, `lastContact`, `driveFolder`, `humanDecision`, `notes`

---

## Drive Folder Structure

```
Awaiting Automation Action/          ← new folder, ID added to config
  Williams, Sarah - 2026-06-03/
    resume.pdf
    Interview Questions: Williams, Sarah - 2026-06-03

Automated Caregiver Applicants/      ← existing root (after Approve)
  Williams, Sarah - 2026-06-03/

_Rejected/                           ← existing (after Reject)
  Torres, Eneida - 2026-06-03/

_Checkback Later/                    ← existing (after Checkback Later)
  Pallotta, Laura - 2026-06-03/
```

---

## Config Changes

One new field added to `config.yaml`:

```yaml
google_drive:
  awaiting_action_folder_id: "<ID of the Awaiting Automation Action folder>"
```

All other folder IDs already exist in config.

---

## Deduplication

On each Evaluate run, the agent loads all `indeedId` values from the Active, Rejected, and Checkback Later tabs before scraping Indeed. Any candidate whose ID is already present is skipped — this is the primary deduplication mechanism and survives `state.json` resets.

`state.json` `processedIds` is retained as a secondary within-run crash recovery mechanism.

---

## Entry Points

| Command | What it runs |
|---|---|
| `npm start` | Evaluate then Act |
| `npm run candidates` | Evaluate only |
| `npm run act` | Act only |

Each entry point is a separate TypeScript file under `src/`:
- `src/index.ts` — existing, updated to run both
- `src/run-candidates.ts` — new
- `src/run-act.ts` — new

---

## What Does NOT Change

- Indeed sentiment is still checked on the listing page — candidates with sentiment already marked are skipped during Evaluate (someone acted on them outside the agent).
- All screening logic (`applyRules`, Google Maps distance, Claude extraction) is unchanged.
- The Slack urgent/strong-candidate alert fires during Evaluate, not Act.
- Tests use fake adapters; no real services are called.
