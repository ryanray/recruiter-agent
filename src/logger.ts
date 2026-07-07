import { execSync } from 'child_process';
import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import type { RunResult } from './types.js';

export function startFileLog(label: string): () => void {
  mkdirSync('logs', { recursive: true });
  const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  const logPath = join('logs', `${timestamp}-${label}.log`);
  const stream = createWriteStream(logPath, { flags: 'a' });

  const write = (args: unknown[]) => {
    stream.write(args.map(a => (typeof a === 'string' ? a : String(a))).join(' ') + '\n');
  };

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args) => { origLog(...args); write(args); };
  console.warn = (...args) => { origWarn(...args); write(args); };
  console.error = (...args) => { origError(...args); write(args); };

  console.log(`[Log] Writing to ${logPath}`);

  return () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    stream.end();
  };
}

export function formatRunLog(result: RunResult): string {
  const totalSecs = Math.round(result.durationMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const timestamp = result.startedAt.toISOString().slice(0, 16).replace('T', ' ');

  const lines: string[] = [
    `${timestamp} — Run complete (duration: ${mins}m ${secs}s)`,
    '',
    `NEW APPLICANTS (${result.newApplicantsReviewed} reviewed, ${result.remainingApplicants} remaining)`,
  ];

  for (const c of result.passed) {
    lines.push(`  ✓ PASS   ${pad(c.name, 22)} ${pad(c.location, 20)} ${c.certifications || c.experience}  → Intro sent`);
  }
  for (const c of result.rejected) {
    lines.push(`  ✗ REJECT  ${pad(c.name, 22)} ${pad(c.location, 20)} ${c.reason}  → Rejection sent`);
  }
  for (const c of result.unsure) {
    lines.push(`  ? UNSURE  ${pad(c.name, 22)} ${pad(c.location, 20)} ${c.unclearField}  → Slacked`);
  }

  if (result.bookings.length > 0 || result.coldCandidates.length > 0) {
    lines.push('', 'EXISTING CANDIDATES');
    for (const b of result.bookings) {
      const time = b.scheduledAt.toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`  📅 BOOKED  ${pad(b.name, 22)} Phone screen: ${time}  → Drive folder created`);
    }
    for (const c of result.coldCandidates) {
      lines.push(`  ❄ COLD    ${pad(c.name, 22)} No reply in ${c.daysSinceContact} days  → Slack alert sent`);
    }
  }

  lines.push('', `ERRORS (${result.errors.length})`);
  for (const e of result.errors) {
    lines.push(`  ✗ ${e.description}`, `    Reason: ${e.reason}`, `    Action: ${e.action}`);
  }

  if (result.pdfFailures.length > 0) {
    lines.push('', `PDF EXTRACTION FAILURES (${result.pdfFailures.length})`);
    for (const name of result.pdfFailures) {
      lines.push(`  ✗ ${name} — PDF text could not be extracted (noted in sheet)`);
    }
  }

  if (result.scoreFailures.length > 0) {
    lines.push('', `SCORE FAILURES (${result.scoreFailures.length})`);
    for (const name of result.scoreFailures) {
      lines.push(`  ✗ ${name} — scoring failed, fallback score of 0 used`);
    }
  }

  if (result.followUpsSent.length > 0) {
    lines.push('', `FOLLOW-UPS SENT (${result.followUpsSent.length})`);
    for (const f of result.followUpsSent) {
      lines.push(`  → ${f.name} — invite #${f.inviteCount}`);
    }
  }

  if (result.neverResponded.length > 0) {
    lines.push('', `NEVER RESPONDED (${result.neverResponded.length})`);
    for (const name of result.neverResponded) {
      lines.push(`  → ${name} — moved after 3 unanswered invites`);
    }
  }

  if (result.humanReviewFlagged.length > 0) {
    lines.push('', `HUMAN REVIEW FLAGGED (${result.humanReviewFlagged.length})`);
    for (const name of result.humanReviewFlagged) {
      lines.push(`  ⚠️ ${name} — applied to multiple jobs, awaiting human decision`);
    }
  }

  lines.push(
    '',
    'SCREENING CRITERIA APPLIED',
    `  Required: ${result.screeningCriteria.required.join(', ')}`,
    `  Bonuses: ${result.screeningCriteria.preferred.join(', ')}`,
    `  Config version: config.yaml @ git commit ${result.configVersion}`,
  );

  return lines.join('\n');
}

export function formatCandidateSummary(result: RunResult): string {
  const timestamp = result.startedAt.toISOString().slice(0, 16).replace('T', ' ');
  const totalSecs = Math.round(result.durationMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const lines: string[] = [
    `*Chandler — Evaluate Run* (${timestamp} UTC, ${mins}m ${secs}s)`,
    `*New applicants reviewed:* ${result.newApplicantsReviewed}  |  Remaining: ${result.remainingApplicants}`,
  ];

  if (result.passed.length > 0) {
    lines.push(`\n*Passed (${result.passed.length}):*`);
    for (const c of result.passed) lines.push(`  ✓ ${c.name} — ${c.location}`);
  }
  if (result.unsure.length > 0) {
    lines.push(`\n*Unsure — needs review (${result.unsure.length}):*`);
    for (const c of result.unsure) lines.push(`  ? ${c.name} — ${c.unclearField}`);
  }
  if (result.rejected.length > 0) {
    lines.push(`\n*Rejected (${result.rejected.length}):*`);
    for (const c of result.rejected) lines.push(`  ✗ ${c.name} — ${c.reason}`);
  }
  if (result.humanReviewFlagged.length > 0) {
    lines.push(`\n*Flagged for Human Review (${result.humanReviewFlagged.length}):*`);
    for (const name of result.humanReviewFlagged) lines.push(`  ⚠️ ${name}`);
  }
  if (result.errors.length > 0) {
    lines.push(`\n*Errors (${result.errors.length}):*`);
    for (const e of result.errors) lines.push(`  ✗ ${e.description}: ${e.reason}`);
  }
  if (result.newApplicantsReviewed === 0) {
    lines.push('\n_No new applicants._');
  }
  return lines.join('\n');
}

export function formatActSummary(params: {
  actioned: { name: string; decision: string }[];
  newlyBooked: { name: string; scheduledAt: string }[];
  followUpsSent: { name: string; inviteCount: number }[];
  neverResponded: string[];
  humanReviewFlagged: string[];
}): string {
  const { actioned, newlyBooked, followUpsSent, neverResponded, humanReviewFlagged } = params;
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [`*Chandler — Act Run* (${timestamp} UTC)`];

  if (actioned.length > 0) {
    lines.push(`\n*Decisions processed (${actioned.length}):*`);
    for (const a of actioned) lines.push(`  • ${a.name} → ${a.decision}`);
  }

  if (newlyBooked.length > 0) {
    lines.push(`\n*Interviews booked (${newlyBooked.length}):*`);
    for (const b of newlyBooked) lines.push(`  • ${b.name} — ${b.scheduledAt}`);
  }

  if (followUpsSent.length > 0) {
    lines.push(`\n*Follow-ups sent (${followUpsSent.length}):*`);
    for (const f of followUpsSent) lines.push(`  • ${f.name} (invite #${f.inviteCount})`);
  }

  if (neverResponded.length > 0) {
    lines.push(`\n*Moved to Never Responded (${neverResponded.length}):*`);
    for (const name of neverResponded) lines.push(`  • ${name}`);
  }

  if (humanReviewFlagged.length > 0) {
    lines.push(`\n*Flagged for Human Review (${humanReviewFlagged.length}):*`);
    for (const name of humanReviewFlagged) lines.push(`  • ${name}`);
  }

  if (actioned.length === 0 && newlyBooked.length === 0 && followUpsSent.length === 0 &&
      neverResponded.length === 0 && humanReviewFlagged.length === 0) {
    lines.push('\n_Nothing to act on._');
  }

  return lines.join('\n');
}

export function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}
