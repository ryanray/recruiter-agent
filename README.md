# Recruiter Agent

Automates inbound caregiver recruiting for Firstlight Home Care of South Jordan. Scrapes new applicants from Indeed, screens them with Claude, organizes files in Google Drive, and tracks everything in Google Sheets — with a human approval step before any messages are sent.

## How it works

The agent has two phases you can run independently:

**Evaluate** (`npm run candidates`) — reads new applicants from Indeed, screens each one with Claude (license, transportation, driving distance, experience), creates a Drive folder with the resume and interview questions template, and adds a row to the Active sheet with the agent's recommendation. No messages are sent to candidates.

**Act** (`npm run act`) — reads the Active sheet for rows where a human has filled in the `humanDecision` column, then executes the appropriate action:

| Decision | What happens |
|---|---|
| `Approve` | Sends intro message on Indeed, triggers phone screen scheduler, moves Drive folder to recruiting root, updates row to "Screened - Invite Sent" |
| `Reject` | Sends rejection message on Indeed, moves Drive folder to _Rejected, moves row to Rejected tab |
| `Checkback Later` | Moves Drive folder to _Checkback Later, moves row to Checkback Later tab |
| `Hold` | Posts a Slack alert for manual review, clears the humanDecision cell |

`npm start` runs both phases in sequence.

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

Creates the required tabs (Active, Rejected, Hired, Checkback Later, Communication Log) and writes the 14-column headers. Safe to re-run — it won't delete existing data rows.

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

Active, Rejected, Hired, and Checkback Later tabs all use the same 14-column layout:

`name` · `phone` · `email` · `indeedUrl` · `indeedId` · `location` · `experience` · `certifications` · `agentRecommendation` · `status` · `lastContact` · `driveFolder` · `humanDecision` · `notes`

Fill in `humanDecision` with `Approve`, `Reject`, `Checkback Later`, or `Hold` — then run `npm run act`.

## Tests

```bash
npm test
```

All tests use fake adapters — no real API calls are made.

## Project structure

```
src/
  agent.ts              # evaluateCandidates + processPendingDecisions
  screening.ts          # Claude extraction + applyRules
  distance.ts           # Google Maps Distance Matrix API
  adapters/
    indeed.ts           # Playwright browser automation
    sheets.ts           # Google Sheets read/write
    drive.ts            # Google Drive folder/file operations
    slack.ts            # Slack message posting
  fakes/                # In-memory adapters for testing
  run-candidates.ts     # npm run candidates entry point
  run-act.ts            # npm run act entry point
  index.ts              # npm start entry point
config.yaml             # Tunable parameters (committed)
state.json              # Last run timestamp + processed IDs (gitignored)
data/chrome-profile/    # Persistent browser session (gitignored)
```
