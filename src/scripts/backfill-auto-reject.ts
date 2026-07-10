import 'dotenv/config';
import { SheetsService } from '../adapters/sheets.js';
import { loadConfig } from '../config.js';

// Scans Active sheet candidates and sets humanDecision=Reject for any whose score
// is below the configured auto_reject_below threshold. The next act run will
// process the actual rejections on Indeed and move rows to the Rejected tab.
// Auto-rejected rows are marked with [AUTO-REJECTED] in the notes column so
// they can be distinguished from human rejections.

const config = loadConfig();
const threshold = config.scoring?.auto_reject_below ?? null;

if (threshold === null) {
  console.log('auto_reject_below is not set in config.yaml — nothing to do.');
  process.exit(0);
}

const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);

console.log(`Scanning Active sheet for candidates with score < ${threshold}...\n`);

const candidates = await sheets.getActiveCandidates();

const eligible = candidates.filter(c => {
  const score = c.score ? parseInt(c.score, 10) : null;
  if (score === null || isNaN(score)) return false;
  const alreadyActioned = ['Screened - Invite Sent', 'Interview Scheduled', 'Onboarding'].includes(c.status);
  const alreadyFlagged = (c.humanDecision ?? '').trim().toLowerCase() === 'reject';
  const alreadyAutoRejected = (c.notes ?? '').includes('[AUTO-REJECTED');
  return score < threshold && !alreadyActioned && !alreadyFlagged && !alreadyAutoRejected;
});

if (eligible.length === 0) {
  console.log('No candidates to update.');
  process.exit(0);
}

console.log(`Found ${eligible.length} candidate(s) to auto-reject:\n`);
for (const c of eligible) {
  console.log(`  ${c.name} — score ${c.score}/100 (${c.scoreTier ?? 'n/a'}) — status: ${c.status}`);
}

console.log(`\nUpdating sheet (humanDecision=Reject, notes prefixed with [AUTO-REJECTED])...`);

for (const c of eligible) {
  const updatedNotes = `[AUTO-REJECTED: score ${c.score}/100 below threshold of ${threshold}] ${c.notes ?? ''}`.trim();
  await sheets.updateCandidateStatus(c.name, c.status, {
    humanDecision: 'Reject',
    notes: updatedNotes,
  });
  console.log(`  ✓ ${c.name}`);
}

console.log(`\nDone. Run "npm run act" to process the rejections on Indeed and move rows to the Rejected tab.`);
