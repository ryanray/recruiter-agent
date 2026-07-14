// Pure logic for the weekly recruiting report. No API calls in this file.

export interface EventCounts {
  applicantsAdded: number;
  invitesSent: number;
  followUpsSent: number;
  phoneNoShows: number;
  inPersonNoShows: number;
  hired: number;
}

// "7/6/2026" → "2026-07-06". Null for anything unparseable or impossible.
export function parseReportDate(input: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// rows: Events!A2:D values — [date, candidate, event, detail]. Range is inclusive.
export function countEvents(rows: string[][], startDate: string, endDate: string): EventCounts {
  const counts: EventCounts = {
    applicantsAdded: 0, invitesSent: 0, followUpsSent: 0,
    phoneNoShows: 0, inPersonNoShows: 0, hired: 0,
  };
  for (const row of rows) {
    const date = String(row[0] ?? '').trim();
    const event = String(row[2] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDate || date > endDate) continue;
    switch (event) {
      case 'applicant_added': counts.applicantsAdded++; break;
      case 'invite_sent': counts.invitesSent++; break;
      case 'follow_up_sent': counts.followUpsSent++; break;
      case 'phone_no_show': counts.phoneNoShows++; break;
      case 'in_person_no_show': counts.inPersonNoShows++; break;
      case 'hired': counts.hired++; break;
      // Unknown event types are ignored for forward compatibility.
    }
  }
  return counts;
}

export function formatWeeklyReport(counts: EventCounts, startLabel: string, endLabel: string): string {
  return [
    `📊 Weekly Recruiting Report: ${startLabel} – ${endLabel}`,
    `• New applicants: ${counts.applicantsAdded}`,
    `• Phone interview invites sent: ${counts.invitesSent}`,
    `• Follow-up invites sent: ${counts.followUpsSent}`,
    `• Phone interview no-shows: ${counts.phoneNoShows}`,
    `• In-person no-shows: ${counts.inPersonNoShows}`,
    `• Offers sent (hired): ${counts.hired}`,
  ].join('\n');
}
