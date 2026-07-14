import { describe, it, expect } from 'vitest';
import { dateFromLogFilename, reorderFolderName, extractEventsFromLog, dedupeEvents } from '../src/backfill.js';

describe('dateFromLogFilename', () => {
  it('extracts the UTC date from start and act log filenames', () => {
    expect(dateFromLogFilename('2026-06-08T06-01-41-start.log')).toBe('2026-06-08');
    expect(dateFromLogFilename('2026-07-01T18-30-00-act.log')).toBe('2026-07-01');
  });

  it('returns null for non-run-log filenames', () => {
    expect(dateFromLogFilename('notes.txt')).toBeNull();
    expect(dateFromLogFilename('2026-06-08-something.log')).toBeNull();
  });
});

describe('reorderFolderName', () => {
  it('reorders "Last, First" to "First Last"', () => {
    expect(reorderFolderName('Bulseco, Tina')).toBe('Tina Bulseco');
  });

  it('splits on the FIRST comma for multi-part last names', () => {
    expect(reorderFolderName('(Morales) Hernandez, Alberta')).toBe('Alberta (Morales) Hernandez');
  });

  it('leaves comma-less names unchanged', () => {
    expect(reorderFolderName('Cher')).toBe('Cher');
  });
});

describe('extractEventsFromLog', () => {
  const FILENAME = '2026-06-08T06-01-41-start.log';

  it('extracts applicant_added from folder-creation lines, preferring the date in the folder name', () => {
    const content = '[Agent] Creating Drive folder: "Bulseco, Tina - 2026-06-07"\n';
    expect(extractEventsFromLog(FILENAME, content)).toEqual([
      { date: '2026-06-07', candidate: 'Tina Bulseco', event: 'applicant_added', detail: '' },
    ]);
  });

  it('extracts invite_sent using the filename date', () => {
    const content = '[Agent] Setting up interview for AYATULAHI OSMAN...\n';
    expect(extractEventsFromLog(FILENAME, content)).toEqual([
      { date: '2026-06-08', candidate: 'AYATULAHI OSMAN', event: 'invite_sent', detail: '' },
    ]);
  });

  it('extracts follow_up_sent from summary lines, mapping invite #N to follow-up N-1', () => {
    const content = '  → Afton Newell — invite #2\n  → Alana Taala — invite #3\n';
    expect(extractEventsFromLog(FILENAME, content)).toEqual([
      { date: '2026-06-08', candidate: 'Afton Newell', event: 'follow_up_sent', detail: '1' },
      { date: '2026-06-08', candidate: 'Alana Taala', event: 'follow_up_sent', detail: '2' },
    ]);
  });

  it('extracts hired from Acting on ... Hire lines (case-insensitive on hire)', () => {
    const content = '[Agent] Acting on Audra Long: Hire\n[Agent] Acting on Jose Gomez: hire\n';
    expect(extractEventsFromLog(FILENAME, content).map(e => e.candidate)).toEqual(['Audra Long', 'Jose Gomez']);
  });

  it('ignores unrelated lines, including other Acting on decisions', () => {
    const content = [
      '[Agent] Acting on Jane Doe: Reject',
      '[Agent] Acting on Amy Pond: Approve',
      '[Indeed] Found candidate: Jane Doe (Sandy, UT) id=abc',
      '[Agent] Moving row to Hired tab...',
    ].join('\n');
    expect(extractEventsFromLog(FILENAME, content)).toEqual([]);
  });

  it('returns nothing for a file whose name is not a run log', () => {
    expect(extractEventsFromLog('notes.txt', '[Agent] Acting on Audra Long: Hire')).toEqual([]);
  });
});

describe('dedupeEvents', () => {
  it('keeps the earliest occurrence per candidate for applicant/invite/hired', () => {
    const result = dedupeEvents([
      { date: '2026-06-10', candidate: 'Jane Doe', event: 'invite_sent', detail: '' },
      { date: '2026-06-08', candidate: 'Jane Doe', event: 'invite_sent', detail: '' },
      { date: '2026-06-09', candidate: 'Amy Pond', event: 'invite_sent', detail: '' },
    ]);
    expect(result).toEqual([
      { date: '2026-06-08', candidate: 'Jane Doe', event: 'invite_sent', detail: '' },
      { date: '2026-06-09', candidate: 'Amy Pond', event: 'invite_sent', detail: '' },
    ]);
  });

  it('dedupes follow-ups per candidate + follow-up number', () => {
    const result = dedupeEvents([
      { date: '2026-06-10', candidate: 'Jane Doe', event: 'follow_up_sent', detail: '1' },
      { date: '2026-06-12', candidate: 'Jane Doe', event: 'follow_up_sent', detail: '1' },
      { date: '2026-06-14', candidate: 'Jane Doe', event: 'follow_up_sent', detail: '2' },
    ]);
    expect(result.map(e => `${e.detail}@${e.date}`)).toEqual(['1@2026-06-10', '2@2026-06-14']);
  });

  it('matches candidates case-insensitively', () => {
    const result = dedupeEvents([
      { date: '2026-06-08', candidate: 'JANE DOE', event: 'hired', detail: '' },
      { date: '2026-06-09', candidate: 'Jane Doe', event: 'hired', detail: '' },
    ]);
    expect(result).toHaveLength(1);
  });
});
