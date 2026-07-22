import 'dotenv/config';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';

const DOCS_FOLDER_ID = '1EQ8CV2WBGKf7PIvIbXTJQcrZEX0DuNPX';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createOrReplaceDoc(
  drive: ReturnType<typeof google.drive>,
  name: string,
  html: string,
): Promise<void> {
  const existing = await drive.files.list({
    q: `'${DOCS_FOLDER_ID}' in parents and name = '${name}' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  for (const f of existing.data.files ?? []) {
    try {
      await drive.files.delete({ fileId: f.id!, supportsAllDrives: true });
    } catch (e: any) {
      if (e?.status !== 404) throw e;
    }
  }

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.document',
      parents: [DOCS_FOLDER_ID],
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from(Buffer.from(html, 'utf-8')),
    },
    fields: 'id,webViewLink',
  });

  console.log(`✓ ${name}`);
  console.log(`  ${res.data.webViewLink}`);
}

// ---------------------------------------------------------------------------
// Doc 1: User Guide
// ---------------------------------------------------------------------------

const USER_GUIDE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>

<h1>Chandler — How It Works</h1>
<p>Chandler is FirstLight's automated recruiting helper. It monitors Indeed for new applicants, reviews applications against your criteria, and manages the recruiting pipeline so your team can focus on the human side of hiring.</p>

<hr>

<h2>What Chandler Does on Every Run</h2>
<ol>
  <li>Pulls new applicants from Indeed</li>
  <li>Downloads each resume and profile</li>
  <li>Screens each candidate against your requirements (license, transportation, distance, experience)</li>
  <li>Scores candidates 0–100 and creates a Google Drive folder with their resume and interview questions</li>
  <li>Adds them to the <strong>Active</strong> sheet with a recommendation</li>
  <li>Acts on any <strong>humanDecision</strong> values your team has set (sends invites, rejects, etc.)</li>
  <li>Follows up with candidates who haven't responded</li>
  <li>Posts one Slack summary per run, with links for anything that needs human attention</li>
</ol>

<h2>What Chandler Will Never Do</h2>
<ul>
  <li>Make a final hiring decision</li>
  <li>Interview a candidate</li>
  <li>Touch a candidate flagged as <strong>Human Review</strong> — those wait for you</li>
  <li>Send more than 3 interview invites to any one candidate</li>
</ul>

<hr>

<h2>The Candidate Pipeline</h2>
<pre>
New applicant on Indeed
        ↓
Chandler screens &amp; scores them
        ↓
Added to Active sheet
   ├── Score &gt; 50 + PASS → auto-approved (invite sent on next run)
   └── Everything else  → waits for your humanDecision
        ↓
You set humanDecision (Approve, Reject, Hire, etc.)
        ↓
Chandler acts on it and clears the column
</pre>

<hr>

<h2>Your Action Column: humanDecision</h2>
<p>The <strong>humanDecision</strong> column in the Active sheet is how you tell Chandler what to do with a candidate. Type one of the values below and Chandler will act on it the next time it runs, then clear the column automatically.</p>

<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>What you type</th><th>What Chandler does</th></tr>
  <tr><td><strong>Approve</strong></td><td>Sends the candidate an interview invite on Indeed and moves to Screened – Invite Sent</td></tr>
  <tr><td><strong>Reject</strong></td><td>Marks no interest on Indeed, moves to the Rejected tab</td></tr>
  <tr><td><strong>Hire</strong></td><td>Moves their Drive folder to Active Employees, reads offer info, sets Indeed status to Hired, moves to Hired tab</td></tr>
  <tr><td><strong>Checkback Later</strong></td><td>Moves to the Checkback Later tab for future consideration</td></tr>
  <tr><td><strong>Hold</strong></td><td>Listed under "Held for review" in the act-run summary — no other action</td></tr>
  <tr><td><strong>None</strong></td><td>Clears the field — Chandler ignores this row</td></tr>
  <tr><td><strong>Do Not Contact</strong></td><td>Clears the field — no action taken anywhere</td></tr>
</table>

<hr>

<h2>Candidate Statuses</h2>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Status</th><th>What it means</th></tr>
  <tr><td>Awaiting Review</td><td>New candidate — Chandler added them, waiting for your decision</td></tr>
  <tr><td>Screened – Invite Sent</td><td>Interview invite sent, waiting for the candidate to book a time</td></tr>
  <tr><td>Interview Scheduled</td><td>Candidate booked their interview</td></tr>
  <tr><td>Human Review</td><td>Flagged for human attention — Chandler won't touch this row until you set humanDecision</td></tr>
  <tr><td>UNSURE</td><td>Chandler wasn't sure if this person qualifies — needs a human look</td></tr>
  <tr><td>Cold</td><td>Candidate hasn't engaged</td></tr>
  <tr><td>Rejected</td><td>Declined — in the Rejected tab</td></tr>
  <tr><td>Never Responded</td><td>Received 3 invites with no response — archived</td></tr>
  <tr><td>Onboarding</td><td>Being hired — in the Hired tab</td></tr>
</table>

<hr>

<h2>Understanding Scores</h2>
<p>Every new candidate gets a score from 0–100 and a tier:</p>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Tier</th><th>What it means</th></tr>
  <tr><td>Tier 1 — Strong Interview</td><td>Top candidates. If they also passed screening, Chandler auto-approves and sends an invite automatically.</td></tr>
  <tr><td>Tier 2 — Interview</td><td>Good candidates. Review and set Approve if interested.</td></tr>
  <tr><td>Tier 3 — Maybe</td><td>Borderline — your judgment call.</td></tr>
  <tr><td>Tier 4 — Pass</td><td>Chandler recommends skipping. You can still override with Approve.</td></tr>
</table>

<hr>

<h2>Run Summaries — What the Sections Mean</h2>
<p>Chandler posts one Slack message per run — one for <strong>Evaluate</strong>, one for <strong>Act</strong> — instead of a separate alert per candidate. Each message is broken into sections; only sections with content appear. Here's what each section means and what to do about it.</p>

<h3>Act-run summary</h3>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Section</th><th>What to do</th></tr>
  <tr><td>🚨 Action required <em>(posted with <code>@here</code>)</em></td><td>Something needs immediate attention — usually missing offer info when processing a hire. Follow the link next to each item.</td></tr>
  <tr><td>Decisions processed</td><td>Confirms which humanDecision values Chandler acted on this run. No action needed — just a record.</td></tr>
  <tr><td>Interviews booked</td><td>A candidate booked their interview. Each entry includes the score/tier and Indeed/Drive links. No action needed — just a heads up.</td></tr>
  <tr><td>Interview results actioned</td><td>Shows what Chandler did in response to a recorded Phone/In-Person Interview Result. No action needed unless something looks off.</td></tr>
  <tr><td>🚩 Held for review</td><td>Someone set humanDecision to Hold. Follow the Indeed link, discuss as a team, and set a new humanDecision when ready.</td></tr>
  <tr><td>⚠️ In-person scheduling needed</td><td>A candidate passed their phone interview. Schedule the in-person interview.</td></tr>
  <tr><td>Follow-ups sent</td><td>Chandler sent another interview invite to a non-responsive candidate. No action needed.</td></tr>
  <tr><td>Moved to Never Responded</td><td>Candidate reached 3 unanswered invites and was archived. No action needed.</td></tr>
  <tr><td>Flagged for Human Review</td><td>This person applied to more than one of your Indeed listings. Follow the Indeed link, decide which position to pursue, then set humanDecision.</td></tr>
</table>

<h3>Evaluate-run summary</h3>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Section</th><th>What to do</th></tr>
  <tr><td>Passed</td><td>Screened and scored. Strong candidates are typically auto-approved — check the Drive folder if you want details.</td></tr>
  <tr><td>❓ Unsure</td><td>Chandler couldn't determine a required field. Follow the Indeed link, open the Active sheet, and set humanDecision.</td></tr>
  <tr><td>Rejected</td><td>Failed screening. No action needed — Chandler handles the rejection.</td></tr>
  <tr><td>⚠️ Flagged for Human Review</td><td>Applied to more than one of your Indeed listings (count shown). Follow the Indeed link and set humanDecision.</td></tr>
  <tr><td>Auto-rejected</td><td>Score fell below the auto-reject threshold. No action needed.</td></tr>
  <tr><td>Previously contacted</td><td>This person applied before. Follow the Indeed link and check their history before proceeding.</td></tr>
</table>

<hr>

<h2>Key Columns in the Active Sheet</h2>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Column</th><th>What it is</th></tr>
  <tr><td>name</td><td>Candidate's full name (Last, First format)</td></tr>
  <tr><td>status</td><td>Current stage in the pipeline</td></tr>
  <tr><td>humanDecision</td><td>Your action column — type here to instruct Chandler</td></tr>
  <tr><td>score</td><td>0–100 rating</td></tr>
  <tr><td>agentRecommendation</td><td>PASS / FAIL / UNSURE from initial screening</td></tr>
  <tr><td>notes</td><td>Chandler's reasoning for its recommendation</td></tr>
  <tr><td>lastContact</td><td>Date of last outreach to the candidate</td></tr>
  <tr><td>inviteCount</td><td>How many interview invites have been sent (max 3)</td></tr>
  <tr><td>driveFolder</td><td>Link to their Google Drive folder (resume + interview questions sheet)</td></tr>
  <tr><td>createdAt</td><td>Date Chandler first added this candidate</td></tr>
</table>

<hr>

<h2>Things to Watch For</h2>
<ul>
  <li><strong>Human Review rows</strong> — nothing will happen until you set humanDecision. Watch for the "Flagged for Human Review" section in the run summary.</li>
  <li><strong>Auto-approved candidates</strong> — Tier 1 candidates with a PASS are automatically approved. They'll receive an invite on the next Chandler run. If you don't want to reach out, set humanDecision to Reject before the next run.</li>
  <li><strong>UNSURE candidates</strong> — these show up in the "Unsure" section of the evaluate-run summary. A human needs to look at the application and decide.</li>
  <li><strong>Follow-ups</strong> — Chandler sends up to 3 interview invites spaced a few days apart. After the 3rd with no response, the candidate is archived to Never Responded.</li>
  <li><strong>Offer info for Hire</strong> — Before setting humanDecision to Hire, make sure the Offer Info tab in the candidate's interview questions sheet is filled out (email, cell phone, start date, rate offered). Chandler will list this in the "Action required" section of the act-run summary if anything is missing.</li>
</ul>

</body>
</html>`;

// ---------------------------------------------------------------------------
// Doc 2: AI Prompts
// ---------------------------------------------------------------------------

const PROMPTS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>

<h1>Chandler — AI Prompts</h1>
<p>When Chandler reviews a candidate, it sends two separate requests to Claude (an AI made by Anthropic). This document shows exactly what those requests say, so you can understand how Chandler forms its opinions.</p>
<p>After the AI steps, Chandler applies simple yes/no rules (not AI) to reach a final PASS / FAIL / UNSURE decision.</p>

<hr>

<h2>Step 1 — Profile Extraction</h2>
<p>The first request extracts structured facts from the candidate's Indeed profile text and resume. Chandler sends this for every new applicant. The AI reads the raw text and returns a structured summary (location, license, transportation, certifications, experience type, years of experience).</p>
<p><em>Note: After this step, Chandler replaces the AI's distance estimate with a real Google Maps driving distance from South Jordan, UT.</em></p>

<h3>Prompt sent to AI:</h3>
<pre style="background:#f5f5f5;padding:12px;border:1px solid #ccc;white-space:pre-wrap;">Extract structured information from this job applicant's profile. Return ONLY valid JSON with no markdown.

Name: [candidate name]
Location on profile: [location from Indeed, or "not provided"]
Resume text: [full resume and Indeed profile text]

Return exactly this JSON structure:
{
  "location": "city, state string or null if not found",
  "hasLicense": true if they mention valid driver's license, false if they say they don't have one, null if not mentioned,
  "hasTransportation": true if they mention reliable transportation or a car, false if they say they don't have transportation, null if not mentioned,
  "certifications": array of strings from this list only: ["CNA", "CPR", "First Aid"] — only include ones explicitly mentioned,
  "experienceTypes": array from ["home_care", "care_facility", "family", "none"] — include all that apply based on their work history,
  "yearsExperience": total years of direct care experience as a number, or null if cannot determine
}</pre>

<hr>

<h2>Step 2 — Scoring</h2>
<p>The second request scores the candidate 0–100, assigns a tier, identifies key strengths and concerns, and suggests interview questions. This is a longer prompt that includes a detailed screening guide and scoring rubric.</p>

<h3>Prompt structure:</h3>
<p>The full prompt sent to the AI is assembled from four parts in this order:</p>
<ol>
  <li><strong>Instructions</strong> — Rules for how to evaluate the resume</li>
  <li><strong>Screening Guide</strong> — What FirstLight looks for in a caregiver</li>
  <li><strong>Scoring Rubric</strong> — How to assign points in each category</li>
  <li><strong>Candidate Resume + Profile</strong> — The actual applicant's text</li>
</ol>

<h3>Part 1 — Instructions:</h3>
<pre style="background:#f5f5f5;padding:12px;border:1px solid #ccc;white-space:pre-wrap;">You are helping FirstLight Home Care of South Jordan screen caregiver resumes.

Use the caregiver resume screening guide and scoring rubric below to evaluate the candidate.

Important rules:
- Score only based on evidence in the resume.
- Do not assume skills that are not stated.
- Do not penalize too harshly for missing information if it can be validated in an interview.
- Separate confirmed strengths from items that need follow-up.
- Do not make hiring decisions based on protected characteristics.
- Focus on caregiving relevance, reliability, transportation, professionalism, and home care fit.</pre>

<h3>Part 2 — Screening Guide (summarized):</h3>
<p>The screening guide tells the AI what to look for. Key sections:</p>
<ul>
  <li><strong>Credential keywords</strong> — CNA, HHA, PCA, DSP, LPN, RN, etc.</li>
  <li><strong>Home care experience</strong> — Home Health, Private Duty, Companion Care, Respite Care, etc.</li>
  <li><strong>Senior care experience</strong> — Dementia, Alzheimer's, Assisted Living, Hospice, etc.</li>
  <li><strong>Hands-on skills</strong> — ADLs, bathing, transfers, meal prep, medication reminders, fall prevention</li>
  <li><strong>Reliability indicators</strong> — Stable employment history, reliable transportation, flexible availability</li>
  <li><strong>Warning signs</strong> — Frequent job changes, unexplained gaps, no transportation mentioned</li>
  <li><strong>Hidden gem candidates</strong> — DSPs, Behavioral Health Technicians, family caregivers, hospice volunteers</li>
</ul>

<h3>Part 3 — Scoring Rubric:</h3>
<pre style="background:#f5f5f5;padding:12px;border:1px solid #ccc;white-space:pre-wrap;">Score the candidate from 0–100 based only on the resume provided.

Scoring Categories:
  1. Relevant Caregiving Experience — 25 pts
     Home care, senior care, assisted living, memory care, hospice, DSP, CNA, PCA, HHA, family caregiving, etc.

  2. Hands-On Care Skills — 20 pts
     ADLs, bathing, dressing, toileting, transfers, dementia care, meal prep, medication reminders,
     mobility assistance, companionship.

  3. Reliability Indicators — 20 pts
     Stable work history, long tenure, reliable transportation, consistent schedule,
     availability, punctuality language.

  4. Home Care Fit — 15 pts
     Experience working independently, one-on-one care, client homes, family communication, care plans.

  5. Communication &amp; Professionalism — 10 pts
     Clear resume, client/family communication, documentation, teamwork, professionalism.

  6. Risk / Concern Factors — 10 pts
     Deduct for short job tenure, unexplained gaps, no relevant experience,
     vague descriptions, job hopping, no transportation mention.</pre>

<h3>Part 4 — Candidate data:</h3>
<pre style="background:#f5f5f5;padding:12px;border:1px solid #ccc;white-space:pre-wrap;">Candidate Resume:
[full resume text — PDF and/or Indeed profile text]

Candidate Profile:
Name: [candidate name]
Location: [location from Indeed]</pre>

<h3>What the AI returns:</h3>
<pre style="background:#f5f5f5;padding:12px;border:1px solid #ccc;white-space:pre-wrap;">{
  "score": 0-100,
  "recommendation": "Strong Interview" | "Interview" | "Maybe" | "Pass",
  "tier": "Tier 1" | "Tier 2" | "Tier 3" | "Tier 4",
  "keyStrengths": "bullet-point summary",
  "concerns": "bullet-point summary",
  "interviewQuestions": "question 1; question 2; question 3"
}</pre>

<hr>

<h2>Step 3 — Screening Rules (No AI involved)</h2>
<p>After the AI extracts the profile data in Step 1, Chandler applies these hard rules to reach its PASS / FAIL / UNSURE recommendation. These rules are configured in Chandler's config file.</p>

<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Rule</th><th>Result if fails</th><th>Result if unknown</th></tr>
  <tr>
    <td>Must be within 30 miles of South Jordan, UT<br><em>(verified via Google Maps driving distance)</em></td>
    <td>FAIL</td>
    <td>UNSURE</td>
  </tr>
  <tr>
    <td>Must have a valid driver's license AND reliable transportation</td>
    <td>FAIL</td>
    <td>UNSURE</td>
  </tr>
</table>

<p>A candidate gets <strong>PASS</strong> only if all required rules pass. One FAIL anywhere means FAIL overall. If a required field can't be determined from the resume, the result is UNSURE — those candidates are flagged for human review in Slack.</p>

<p><strong>Auto-approve threshold:</strong> If a candidate gets PASS + score above 50, Chandler automatically sets humanDecision to "Approve" so an interview invite goes out on the next run without anyone needing to act.</p>

<hr>

<h2>What Chandler Does NOT Ask the AI</h2>
<ul>
  <li>Whether to hire the candidate — that's always a human decision</li>
  <li>Anything about protected characteristics (age, race, religion, etc.)</li>
  <li>Whether to approve or reject — the AI only informs, it doesn't decide</li>
</ul>

</body>
</html>`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });

  await createOrReplaceDoc(drive, 'Chandler — How It Works', USER_GUIDE_HTML);
  await createOrReplaceDoc(drive, 'Chandler — AI Prompts', PROMPTS_HTML);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
