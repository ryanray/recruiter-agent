// Pure log-parsing logic for the one-time Events backfill.
// No filesystem or API calls in this file.

export interface BackfillEvent {
  date: string;      // YYYY-MM-DD
  candidate: string;
  event: 'applicant_added' | 'invite_sent' | 'follow_up_sent' | 'hired';
  detail: string;
}

// "2026-06-08T06-01-41-start.log" → "2026-06-08". This is the UTC date, which
// matches what the live logEvent would have written during that run (today()
// is UTC-based everywhere in this codebase). Null if not a run-log filename.
export function dateFromLogFilename(filename: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}-(?:start|act)\.log$/.exec(filename);
  return m ? m[1] : null;
}

// "Last, First" → "First Last"; splits on the FIRST comma. Comma-less input
// is returned unchanged.
export function reorderFolderName(name: string): string {
  const idx = name.indexOf(', ');
  if (idx === -1) return name;
  return `${name.slice(idx + 2)} ${name.slice(0, idx)}`;
}

const FOLDER_LINE = /^\[Agent\] Creating Drive folder: "(.+) - (\d{4}-\d{2}-\d{2})"$/;
const INVITE_LINE = /^\[Agent\] Setting up interview for (.+)\.\.\.$/;
const FOLLOW_UP_LINE = /^→ (.+) — invite #(\d)$/;
const HIRE_LINE = /^\[Agent\] Acting on (.+): [Hh]ire$/;

export function extractEventsFromLog(filename: string, content: string): BackfillEvent[] {
  const fileDate = dateFromLogFilename(filename);
  if (!fileDate) return [];
  const events: BackfillEvent[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    let m = FOLDER_LINE.exec(line);
    if (m) {
      // The folder name carries the run's own date — prefer it over the filename date.
      events.push({ date: m[2], candidate: reorderFolderName(m[1]), event: 'applicant_added', detail: '' });
      continue;
    }
    m = INVITE_LINE.exec(line);
    if (m) {
      events.push({ date: fileDate, candidate: m[1], event: 'invite_sent', detail: '' });
      continue;
    }
    m = FOLLOW_UP_LINE.exec(line);
    if (m) {
      // Summary line "invite #2" means follow-up 1 (invite #1 was the initial invite).
      events.push({ date: fileDate, candidate: m[1], event: 'follow_up_sent', detail: String(Number(m[2]) - 1) });
      continue;
    }
    m = HIRE_LINE.exec(line);
    if (m) {
      events.push({ date: fileDate, candidate: m[1], event: 'hired', detail: '' });
    }
  }
  return events;
}

// applicant_added / invite_sent / hired: unique per candidate (earliest kept).
// follow_up_sent: unique per candidate + follow-up number (earliest kept).
// Protects against retried runs and reprocessed candidates in multiple logs.
export function dedupeEvents(events: BackfillEvent[]): BackfillEvent[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();
  const result: BackfillEvent[] = [];
  for (const e of sorted) {
    const key = e.event === 'follow_up_sent'
      ? `${e.event}|${e.candidate.toLowerCase()}|${e.detail}`
      : `${e.event}|${e.candidate.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(e);
  }
  return result;
}
