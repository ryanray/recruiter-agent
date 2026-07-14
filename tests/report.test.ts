import { describe, it, expect } from 'vitest';
import { parseReportDate, countEvents, formatWeeklyReport } from '../src/report.js';

describe('parseReportDate', () => {
  it('parses M/D/YYYY into YYYY-MM-DD', () => {
    expect(parseReportDate('7/6/2026')).toBe('2026-07-06');
    expect(parseReportDate('12/25/2026')).toBe('2026-12-25');
  });

  it('accepts already-padded input', () => {
    expect(parseReportDate('07/06/2026')).toBe('2026-07-06');
  });

  it('rejects garbage, wrong separators, and impossible dates', () => {
    expect(parseReportDate('yesterday')).toBeNull();
    expect(parseReportDate('2026-07-06')).toBeNull();
    expect(parseReportDate('13/1/2026')).toBeNull();
    expect(parseReportDate('2/30/2026')).toBeNull();
    expect(parseReportDate('')).toBeNull();
  });
});

describe('countEvents', () => {
  const rows = [
    ['2026-07-05', 'Early Bird', 'applicant_added', ''],
    ['2026-07-06', 'Jane Doe', 'applicant_added', ''],
    ['2026-07-06', 'Jane Doe', 'invite_sent', ''],
    ['2026-07-08', 'Jane Doe', 'follow_up_sent', '1'],
    ['2026-07-10', 'Amy Pond', 'phone_no_show', ''],
    ['2026-07-11', 'Rory Williams', 'in_person_no_show', ''],
    ['2026-07-12', 'River Song', 'hired', ''],
    ['2026-07-12', 'River Song', 'some_future_event', ''],
    ['2026-07-13', 'Late Comer', 'applicant_added', ''],
  ];

  it('counts each event type within the inclusive range', () => {
    const counts = countEvents(rows, '2026-07-06', '2026-07-12');
    expect(counts).toEqual({
      applicantsAdded: 1,
      invitesSent: 1,
      followUpsSent: 1,
      phoneNoShows: 1,
      inPersonNoShows: 1,
      hired: 1,
    });
  });

  it('includes events exactly on the start and end dates', () => {
    const counts = countEvents(rows, '2026-07-05', '2026-07-13');
    expect(counts.applicantsAdded).toBe(3);
  });

  it('ignores unknown event types and malformed rows', () => {
    const counts = countEvents([['', '', '', ''], ['2026-07-06']], '2026-07-01', '2026-07-31');
    expect(counts).toEqual({
      applicantsAdded: 0, invitesSent: 0, followUpsSent: 0,
      phoneNoShows: 0, inPersonNoShows: 0, hired: 0,
    });
  });

  it('skips rows with locale-formatted dates (e.g. 7/6/2026) — ISO format required', () => {
    // Sheets can return locale-formatted dates when valueInputOption was USER_ENTERED.
    // With the ISO-format guard, these must be skipped, not miscounted.
    // Row with a Sheets date serial number (number, not string) must also not throw.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mixedRows: any = [
      ['7/6/2026', 'Alice', 'applicant_added', ''],   // locale M/D/YYYY — skip
      [46578, 'Bob', 'invite_sent', ''],               // Sheets serial number — must not throw, skip
      ['2026-07-06', 'Carol', 'applicant_added', ''], // valid ISO — count
    ];
    expect(() => countEvents(mixedRows, '2026-07-01', '2026-07-31')).not.toThrow();
    const counts = countEvents(mixedRows, '2026-07-01', '2026-07-31');
    // Only Carol's ISO row should count
    expect(counts.applicantsAdded).toBe(1);
    expect(counts.invitesSent).toBe(0);
  });

  it('does not throw and skips rows containing null cells in date or event columns', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nullRows: any = [
      [null, 'X', 'applicant_added', ''],  // null date → skipped
      [null, null, null, null],             // all null → skipped
    ];
    expect(() => countEvents(nullRows, '2026-07-01', '2026-07-31')).not.toThrow();
    const counts = countEvents(nullRows, '2026-07-01', '2026-07-31');
    expect(counts).toEqual({
      applicantsAdded: 0, invitesSent: 0, followUpsSent: 0,
      phoneNoShows: 0, inPersonNoShows: 0, hired: 0,
    });
  });
});

describe('formatWeeklyReport', () => {
  it('formats all six lines with zeros shown explicitly', () => {
    const text = formatWeeklyReport(
      { applicantsAdded: 12, invitesSent: 8, followUpsSent: 5, phoneNoShows: 2, inPersonNoShows: 1, hired: 0 },
      '7/6/2026',
      '7/12/2026'
    );
    expect(text).toBe([
      '📊 Weekly Recruiting Report: 7/6/2026 – 7/12/2026',
      '• New applicants: 12',
      '• Phone interview invites sent: 8',
      '• Follow-up invites sent: 5',
      '• Phone interview no-shows: 2',
      '• In-person no-shows: 1',
      '• Offers sent (hired): 0',
    ].join('\n'));
  });
});
