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

  lines.push(
    '',
    'SCREENING CRITERIA APPLIED',
    `  Required: ${result.screeningCriteria.required.join(', ')}`,
    `  Bonuses: ${result.screeningCriteria.preferred.join(', ')}`,
    `  Config version: config.yaml @ git commit ${result.configVersion}`,
  );

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
