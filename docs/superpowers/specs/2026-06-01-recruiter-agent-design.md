# Recruiter Agent Design
**Firstlight Home Care of South Jordan**
Date: 2026-06-01

## Overview

A manually-triggered TypeScript agent that automates the inbound caregiver recruiting pipeline for Firstlight Home Care of South Jordan. The agent controls a Chrome browser to interact with Indeed, screens candidates against configurable criteria, manages a Google Sheets pipeline tracker, creates organized Google Drive folders per candidate, and posts Slack alerts to the recruiting team.

The agent runs on demand (`npx ts-node agent.ts`) and processes a configurable batch of candidates per run. A cron schedule can be added later via config.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Claude Orchestrator Agent           │
│  (screens, decides, routes, drafts messages)    │
└───────┬──────────┬──────────┬──────────┬────────┘
        │          │          │          │
   Playwright   Google     Google      Slack
   MCP          Sheets MCP  Drive MCP   MCP
   (Indeed)     (tracker)  (docs/files) (alerts)
        │
   ┌────▼──────────────────────────┐
   │  Indeed Web UI (Chrome)       │
   │  - Read new applications      │
   │  - Send messages              │
   │  - Trigger scheduler          │
   └───────────────────────────────┘
```

### Technology Stack

| Component | Technology |
|---|---|
| Language | TypeScript (Node.js) |
| Agent brain | Anthropic SDK for TypeScript (claude-sonnet-4-6) |
| Browser automation | Playwright MCP server |
| Google Sheets | Google Sheets MCP server |
| Google Drive | Google Drive MCP server |
| Slack | Slack MCP server |
| Trigger | Manual (`npx ts-node agent.ts`) |
| Config | `config.yaml` in git |
| Run logs | Google Doc (appended each run) |

---

## Configuration

All tunable parameters live in `config.yaml`, checked into git. No code changes are needed to adjust screening behavior.

```yaml
run:
  trigger: manual              # options: manual, cron (future)
  max_candidates_per_run: 10   # set to null for no limit

screening:
  required:
    - valid_license_and_transportation
    - within_20_miles_south_jordan
  preferred:
    - cna_certification
    - cpr_first_aid
    - home_care_experience
    - care_facility_experience
    - family_caregiving_experience
  disqualifying: []

scheduling:
  cold_candidate_days: 3

messages:
  intro: "Hi {name}, thanks for applying to Firstlight Home Care..."
  rejection: "Hi {name}, we appreciate your interest in Firstlight Home Care..."

google_drive:
  recruiting_root_folder_id: ""         # "Caregiver Applicants" folder ID
  checkback_folder_id: ""               # "_Checkback later Applicants" folder ID
  rejected_folder_id: ""                # "_Rejected Applicants" folder ID
  interview_template_sheet_id: ""       # existing interview questions template ID
  run_log_doc_id: ""                    # Google Doc for run logs

google_sheets:
  tracker_spreadsheet_id: ""            # main pipeline tracker

slack:
  recruiting_channel: "#recruiting"
```

---

## Pipeline Flow

The agent executes the following steps on each run:

### 1. Log into Indeed
Playwright navigates to Indeed Employer and authenticates.

### 2. Read new applications
Fetch all applications submitted since the last run. The timestamp of the last successful run is stored in a local `state.json` file (not checked into git) so the agent knows where to resume.

### 3. Screen each candidate (up to `max_candidates_per_run`)

For each applicant:

**PASS** — meets all required criteria:
- Send Indeed intro message (from config template)
- Trigger Indeed's built-in phone screen scheduler
- Add to "Active" tab in Google Sheets tracker
- No Slack alert (routine action)

**FAIL** — fails one or more required criteria:
- Send Indeed polite rejection message (from config template)
- Add to "Rejected" tab in Google Sheets tracker
- Move Drive folder to `_Rejected Applicants/` if one exists (only candidates who previously booked will have a folder)
- Silent log only, no Slack alert

**UNSURE** — agent cannot determine a required criterion:
- Add to "Active" tab with UNSURE flag
- Post to Slack for human review

### 4. Handle interview bookings
When a candidate books a phone screen via Indeed's scheduler:
- Create a Drive folder: `{LastName}_{FirstName}_{YYYY-MM-DD}` inside `Caregiver Applicants/`
- Download resume from Indeed → save to folder
- Copy interview template sheet into folder
- Update candidate's Status in Active tab to `Interview Scheduled`, add Drive folder link
- Post to Slack: candidate name, phone screen time, Drive folder link

### 5. Check for cold candidates
Any active candidate with no response in `cold_candidate_days` days:
- Post to Slack: candidate name, days since contact, link to their Sheets row

### 6. Write run log
Append a detailed entry to the Google Doc run log:

```
2026-06-01 10:00 — Run complete (duration: Xm Xs)

NEW APPLICANTS (N reviewed, M remaining)
  ✓ PASS   [Name]  [City, UT]  [Certs/experience]  → Intro sent
  ✗ REJECT  [Name]  [City, UT]  [Reason]             → Rejection sent
  ? UNSURE  [Name]  [City, UT]  [What was unclear]   → Slacked

EXISTING CANDIDATES
  ❄ COLD    [Name]  No reply in N days               → Slack alert sent
  📅 BOOKED  [Name]  Phone screen: [date/time]        → Drive folder created

ERRORS (N)
  ✗ [Description of error, reason, action taken]

SCREENING CRITERIA APPLIED
  Required: [list from config]
  Bonuses: [list from config]
  Config version: config.yaml @ git commit [hash]
```

---

## Google Sheets Tracker Structure

**Active** — all candidates currently in the pipeline, regardless of stage

| Name | Phone | Email | Indeed URL | Location | Experience | Certifications | Status | Last Contact | Drive Folder | Notes |

The Status column uses explicit values so the agent always knows what state a candidate is in:

| Status value | Meaning |
|---|---|
| `Screened - Invite Sent` | Passed screening, intro message + Indeed scheduler invite sent, awaiting response |
| `Interview Scheduled` | Accepted the phone screen booking, Drive folder created |
| `Cold` | No response after `cold_candidate_days` days since invite sent |
| `UNSURE` | Agent couldn't determine a required criterion, human review needed |

Candidates remain in Active through all of these states. They move out only when a human makes a final decision (Hired, Rejected, Checkback Later). The cold candidate check only applies to candidates with status `Screened - Invite Sent` — candidates who have already scheduled are not flagged as cold.

**Checkback Later** — human decision only; agent never moves candidates here

| Name | Phone | Email | Indeed URL | Notes | Drive Folder |

**Rejected** — screened out

| Name | Applied | Rejection Reason | Message Sent |

**Hired** — completed pipeline

| Name | Hire Date | Drive Folder | Notes |

**Communication Log** — full message history

| Date | Candidate | Direction | Message | Channel |

---

## Google Drive Structure

```
Caregiver Applicants/                         ← existing root folder
├── _Checkback later Applicants/              ← existing (human-managed)
├── _Rejected Applicants/                     ← existing
└── {LastName}_{FirstName}_{YYYY-MM-DD}/      ← agent creates on booking
    ├── resume.pdf
    └── Interview Questions (copy of template)
```

Folder moves:
- **Rejected:** agent moves folder to `_Rejected Applicants/`
- **Checkback Later:** human moves folder manually after updating Sheets

---

## Slack Alerts

All alerts post to `#recruiting`. Four triggers:

| Trigger | Message includes |
|---|---|
| Interview scheduled | Candidate name, phone screen time, Drive folder link |
| Candidate goes cold | Candidate name, days since contact, Sheets row link |
| Agent unsure | Candidate name, what it couldn't determine, Indeed profile link |
| Urgent / strong candidate | Candidate name, why flagged, Indeed profile link. Triggered when candidate has CNA certification plus 1+ year of home care or care facility experience. |

Humans respond to UNSURE and Checkback alerts by updating the Google Sheet status column directly. The agent reads the updated status on its next run and acts accordingly. No Slack bot commands required in v1.

---

## Error Handling

| Situation | Agent behavior |
|---|---|
| Indeed login fails / session expired | Stop run, post to Slack |
| Page layout changed (Playwright element not found) | Stop run, post to Slack with screenshot |
| Can't determine candidate location | Flag UNSURE, post to Slack |
| Google Sheets write fails | Retry 3x, then post to Slack |
| Google Drive folder creation fails | Post to Slack, candidate stays Active without folder link |
| Slack notification fails | Write to local error log — never silently drop an alert |
| Run exceeds 30 minutes | Kill run, post to Slack |

---

## Out of Scope (v1)

- Cron/scheduled runs (config flag ready, not wired up)
- Slack bot commands (`/recruit run`, `/recruit checkback`)
- Active outreach / searching Indeed resume database
- Multi-location support (single South Jordan franchise only)
- Background check integration

## Fallback: Claude Chrome Extension

If Indeed blocks or rate-limits the Playwright browser automation, the Claude Chrome Extension (human-in-the-loop mode) is the fallback. In this mode:

- A human navigates Indeed Employer in Chrome with the Claude extension active
- Claude reads the current page, screens each candidate, and drafts messages
- The human executes each action manually (send message, trigger scheduler)
- Google Sheets, Google Drive, and Slack integrations remain fully automated in the background
- The extension looks like a normal human browsing session — no anti-bot risk

The Playwright approach is attempted first. If account flagging becomes a problem, the architecture can be adapted to this mode without redesigning the non-Indeed integrations.
