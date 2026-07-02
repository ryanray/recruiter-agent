import 'dotenv/config';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';

const DOCS_FOLDER_ID = '1EQ8CV2WBGKf7PIvIbXTJQcrZEX0DuNPX';
const DOC_NAME = 'Chandler — How It Works';

const HTML = `<!DOCTYPE html>
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
  <li>Posts Slack alerts for anything that needs human attention</li>
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
  <tr><td><strong>Hold</strong></td><td>Posts a Slack alert for the team to discuss — no other action</td></tr>
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
  <tr><th>Tier</th><th>Score range (approx)</th><th>What it means</th></tr>
  <tr><td>Tier 1 — Strong Interview</td><td>High</td><td>Top candidates. If they also passed screening, Chandler auto-approves and sends an invite automatically.</td></tr>
  <tr><td>Tier 2 — Interview</td><td>Good</td><td>Good candidates. Review and set Approve if interested.</td></tr>
  <tr><td>Tier 3 — Maybe</td><td>Borderline</td><td>Your judgment call.</td></tr>
  <tr><td>Tier 4 — Pass</td><td>Low</td><td>Chandler recommends skipping. You can still override with Approve.</td></tr>
</table>

<hr>

<h2>Slack Alerts — What They Mean</h2>
<table border="1" cellpadding="6" cellspacing="0">
  <tr><th>Alert</th><th>What to do</th></tr>
  <tr><td>🚨 Strong candidate</td><td>High-scoring CNA applied. Chandler likely auto-approved — check their Drive folder.</td></tr>
  <tr><td>❓ Review needed</td><td>Chandler was unsure. Open the Active sheet, look at the candidate, and set humanDecision.</td></tr>
  <tr><td>⚠️ Human review needed: applied to multiple jobs</td><td>This person applied to more than one of your Indeed listings. Decide which position to pursue, then set humanDecision.</td></tr>
  <tr><td>⚠️ Previously contacted</td><td>This person applied before. Check their history before proceeding.</td></tr>
  <tr><td>🗓 Interview scheduled</td><td>A candidate booked their interview. No action needed — just a heads up.</td></tr>
  <tr><td>🚩 Hold for review</td><td>Someone set humanDecision to Hold. The team should discuss this candidate.</td></tr>
  <tr><td>@here Action required</td><td>Something needs immediate attention — usually missing offer info when processing a hire. Follow the link in the message.</td></tr>
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
  <li><strong>Human Review rows</strong> — nothing will happen until you set humanDecision. Watch for the ⚠️ alert in Slack.</li>
  <li><strong>Auto-approved candidates</strong> — Tier 1 candidates with a PASS are automatically approved. They'll receive an invite on the next Chandler run. If you don't want to reach out, set humanDecision to Reject before the next run.</li>
  <li><strong>UNSURE candidates</strong> — Chandler posted a ❓ alert for these. A human needs to look at the application and decide.</li>
  <li><strong>Follow-ups</strong> — Chandler sends up to 3 interview invites spaced a few days apart. After the 3rd with no response, the candidate is archived to Never Responded.</li>
  <li><strong>Offer info for Hire</strong> — Before setting humanDecision to Hire, make sure the Offer Info tab in the candidate's interview questions sheet is filled out (email, cell phone, start date, rate offered). Chandler will alert you in Slack if anything is missing.</li>
</ul>

</body>
</html>`;

async function main() {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });

  // Check if the doc already exists in the folder
  const existing = await drive.files.list({
    q: `'${DOCS_FOLDER_ID}' in parents and name = '${DOC_NAME}' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  const existingFiles = existing.data.files ?? [];

  if (existingFiles.length > 0) {
    // Delete old version(s) and recreate — Drive API can't update Google Doc content directly
    for (const f of existingFiles) {
      await drive.files.delete({ fileId: f.id!, supportsAllDrives: true });
      console.log(`Deleted old doc: ${f.name} (${f.id})`);
    }
  }

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: DOC_NAME,
      mimeType: 'application/vnd.google-apps.document',
      parents: [DOCS_FOLDER_ID],
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from(Buffer.from(HTML, 'utf-8')),
    },
    fields: 'id,webViewLink',
  });

  console.log(`Created: ${DOC_NAME}`);
  console.log(`Link: ${res.data.webViewLink}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
