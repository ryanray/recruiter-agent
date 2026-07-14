# Recruiter Agent

Automates inbound caregiver recruiting for Firstlight Home Care of South Jordan. Scrapes new applicants from Indeed, screens them with Claude, organizes files in Google Drive, and tracks everything in Google Sheets — with a human approval step before any messages are sent.

## How it works

The agent has two phases you can run independently:

**Evaluate** (`npm run candidates`) — reads new applicants from Indeed, screens each one with Claude (license, transportation, driving distance, experience), creates a Drive folder with the resume and interview questions template, and adds a row to the Active sheet with the agent's recommendation. No messages are sent to candidates.

**Act** (`npm run act`) — processes interview results, acts on human decisions, records newly booked interviews, and sends follow-ups:

1. **Interview results** — reads the `Phone Interview Result` and `In-Person Interview Result` columns. A phone `Passed` advances the candidate to "In-Person Interview Scheduled"; `Failed`/`No-Show` queues a rejection; an in-person `Hired` queues the hire flow; `Rejected`/`No-Show` queues a rejection. `None` (or blank) means no action.
2. **Human decisions** — reads the Active sheet for rows where a human has filled in `humanDecision`:

| Decision | What happens |
|---|---|
| `Approve` | Sends the interview invite on Indeed, moves Drive folder to recruiting root, updates row to "Screened - Invite Sent" |
| `Reject` | Marks sentiment "no" on Indeed (Indeed sends its automated follow-up), moves Drive folder to _Rejected, moves row to Rejected tab |
| `Checkback Later` | Moves Drive folder to _Checkback Later, moves row to Checkback Later tab |
| `Hold` | Posts a Slack alert for manual review |
| `Hire` | Validates the Offer Info tab in the candidate's interview sheet, sets Indeed status to Hired, moves row to Hired tab, adds the hire to the Tracker tab |
| `None` / `Do Not Contact` | No action |

3. **Booked interviews** — checks Indeed for candidates who scheduled their phone screen and updates their row to "Interview Scheduled".
4. **Follow-ups** — candidates at "Screened - Invite Sent" with no response get up to two follow-up messages (`scheduling.follow_up_days` apart); after three invites with no response the row moves to Never Responded.

`npm start` runs both phases in sequence.

Every reportable action (applicant added, invite sent, follow-up sent, no-shows, hires) is also appended to an `Events` tab, which feeds the weekly report.

## Setup

### Prerequisites

- Node.js 22+
- A Google Cloud project with Drive, Sheets, and Maps APIs enabled
- An Indeed employer account (logged in via Google OAuth)
- A Slack bot token with `chat:write` scope

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in:

```
ANTHROPIC_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_MAPS_API_KEY=
SLACK_BOT_TOKEN=
```

To get a Google refresh token, run the OAuth flow once and copy the token from the output. The app needs Drive and Sheets scopes.

### 3. Configure the agent

Copy `config.yaml.example` to `config.yaml` and fill in your folder/sheet IDs:

```yaml
google_drive:
  recruiting_root_folder_id: ""        # "Automated Caregiver Applicants" folder
  awaiting_action_folder_id: ""        # "Awaiting Automation Action" folder
  checkback_folder_id: ""              # "_Checkback Later" folder
  rejected_folder_id: ""              # "_Rejected" folder
  interview_template_sheet_id: ""      # Interview questions template sheet
  run_log_doc_id: ""

google_sheets:
  tracker_spreadsheet_id: ""           # Recruiting tracker spreadsheet
```

Folder IDs are the long string at the end of a Google Drive URL: `drive.google.com/drive/folders/<ID>`.

### 4. Set up the Google Sheet

```bash
npx tsx smoke/setup-sheets.ts
```

Creates the base tabs (Active, Rejected, Hired, Checkback Later, Communication Log) and writes the original headers. Safe to re-run — it won't delete existing data rows. Then bring the sheet up to the current layout with the migration scripts: `npm run add-score-columns`, `npm run add-interview-result-columns`, and `npm run add-events-tab`.

### 5. Log in to Indeed

On first run, a browser window will open. Sign in to your Indeed employer account via Google OAuth. The session is saved to `data/chrome-profile/` and reused on subsequent runs.

## Running

```bash
# Evaluate new candidates only (adds rows to Active sheet for human review)
npm run candidates

# Act on human decisions already entered in the sheet
npm run act

# Both in sequence
npm start
```

## Weekly report

```bash
npm run weekly-report -- 7/6/2026 7/12/2026
```

Counts events from the Events tab for the date range (inclusive, `M/D/YYYY`), prints the report, and posts it to the recruiting Slack channel: new applicants, phone interview invites, follow-ups, phone/in-person no-shows, and offers sent.

## One-time setup & migration scripts

| Command | Purpose |
|---|---|
| `npm run seed-previously-contacted` | Seed the Previously Contacted tab from historical data |
| `npm run add-score-columns` | Migration: add the scoring columns to candidate tabs |
| `npm run add-interview-result-columns` | Migration: add phone/in-person interview result columns |
| `npm run add-events-tab` | Create the Events tab (idempotent) |
| `npm run backfill-events` | Populate the Events tab from `logs/*.log` (refuses to run twice) |
| `npm run backfill-auto-reject` | Migration: apply auto-reject threshold to existing rows |
| `npm run create-docs` | Publish the user guide docs to Google Drive |
| `npm run announce-update -- "message"` | Post an update announcement to Slack |

## Screening rules

Rules are defined in `config.yaml`:

```yaml
screening:
  required:
    - valid_license_and_transportation
    - within_30_miles_south_jordan   # number is parsed from the rule name
  preferred:
    - cna_certification
    - home_care_experience
```

A candidate is flagged as **urgent** (Slack alert fires immediately) if they have a CNA certification and 1+ year of direct care experience.

## Spreadsheet columns

Active, Rejected, Hired, Never Responded, and Checkback Later tabs all use the same 28-column layout (defined in `src/adapters/sheets.ts`):

`name` · `phone` · `email` · `indeedUrl` · `indeedId` · `location` · `experience` · `certifications` · `agentRecommendation` · `status` · `lastContact` · `driveFolder` · `humanDecision` · `phoneInterviewResult` · `inPersonInterviewResult` · `notes` · `score` · `scoreRecommendation` · `scoreTier` · `keyStrengths` · `scoreConcerns` · `interviewQuestions` · `processedAt` · `inviteSentAt` · `interviewScheduledAt` · `inviteCount` · `inPersonInterviewScheduledAt` · `createdAt`

The columns humans fill in:

- `humanDecision` — `Approve`, `Reject`, `Checkback Later`, `Hold`, `Hire`, `None`, or `Do Not Contact`
- `Phone Interview Result` — `None`, `Passed`, `Failed`, or `No-Show`
- `In-Person Interview Result` — `None`, `Hired`, `Rejected`, or `No-Show`

Then run `npm run act`.

The `Events` tab (`Date | Candidate | Event | Detail`) is append-only and written by the agent — don't edit it by hand.

## Tests

```bash
npm test
```

All tests use fake adapters — no real API calls are made.

## Project structure

```
src/
  agent.ts              # Orchestrator: evaluate, decisions, interview results, follow-ups
  screening.ts          # Claude extraction + applyRules
  scorer.ts             # Claude candidate scoring (0-100 + tier)
  distance.ts           # Google Maps Distance Matrix API
  report.ts             # Weekly report logic (pure, unit-tested)
  backfill.ts           # Log-parsing logic for the Events backfill (pure)
  logger.ts             # Run summaries (Slack + run log)
  adapters/
    indeed.ts           # Playwright browser automation
    sheets.ts           # Google Sheets read/write
    drive.ts            # Google Drive folder/file operations
    slack.ts            # Slack message posting
  fakes/                # In-memory adapters for testing
  scripts/              # One-time setup/migration scripts + weekly-report
  run-candidates.ts     # npm run candidates entry point
  run-act.ts            # npm run act entry point
  index.ts              # npm start entry point
config.yaml             # Tunable parameters (committed)
state.json              # Last run timestamp + processed IDs (gitignored)
logs/                   # Per-run console logs (gitignored)
data/chrome-profile/    # Persistent browser session (gitignored)
```
