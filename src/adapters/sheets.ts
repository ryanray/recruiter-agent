import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import type { SheetsAdapter, CandidateRow, CandidateStatus, PreviouslyContactedEntry, OfferInfo } from '../types.js';

const COLUMNS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
  'score','scoreRecommendation','scoreTier','keyStrengths','scoreConcerns','interviewQuestions',
  'processedAt','inviteSentAt','interviewScheduledAt','inviteCount',
] as const;

type ColName = typeof COLUMNS[number];

export class SheetsService implements SheetsAdapter {
  private spreadsheetId: string;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
  }

  async addCandidate(tab: string, candidate: CandidateRow): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const values = [COLUMNS.map(col => (candidate as Record<string, unknown>)[col] ?? '')];
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${tab}!A:X`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A:X',
    });
    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex((r, i) => i > 0 && r[0]?.trim() === name.trim());
    if (rowIndex === -1) return;

    const row = [...(rows[rowIndex] as string[])];
    row[COLUMNS.indexOf('status')] = status;
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        const colIdx = COLUMNS.indexOf(key as ColName);
        if (colIdx !== -1) row[colIdx] = String(value ?? '');
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Active!A${rowIndex + 1}:X${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:X',
    });
    const rows = response.data.values ?? [];
    return rows.map(row => {
      const candidate: Record<string, string> = {};
      COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
      return candidate as unknown as CandidateRow;
    });
  }

  async getEvaluatedCandidates(): Promise<{ ids: Set<string>; names: Set<string> }> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const ids = new Set<string>();
    const names = new Set<string>();
    const indeedIdCol = COLUMNS.indexOf('indeedId');
    const nameCol = COLUMNS.indexOf('name');

    for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A2:X`,
      });
      for (const row of response.data.values ?? []) {
        const id = (row[indeedIdCol] as string | undefined)?.trim();
        if (id) ids.add(id);
        const name = (row[nameCol] as string | undefined)?.trim().toLowerCase();
        if (name) names.add(name);
      }
    }
    return { ids, names };
  }

  async getCandidatesForAction(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:X',
    });
    const rows = response.data.values ?? [];
    const humanDecisionCol = COLUMNS.indexOf('humanDecision');
    return rows
      .filter(row => {
        const val = ((row[humanDecisionCol] as string) ?? '').trim();
        return val && val.toLowerCase() !== 'none';
      })
      .map(row => {
        const candidate: Record<string, string> = {};
        COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
        return candidate as unknown as CandidateRow;
      });
  }

  async moveCandidate(name: string, fromTab: string, toTab: string): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${fromTab}!A:X`,
    });
    const rows = readRes.data.values ?? [];
    const rowIndex = rows.findIndex((r, i) => i > 0 && (r[0] as string)?.trim() === name.trim());
    if (rowIndex === -1) return;

    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${toTab}!A:X`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rows[rowIndex]] },
    });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const sheetId = meta.data.sheets
      ?.find(s => s.properties?.title === fromTab)
      ?.properties?.sheetId;
    if (sheetId == null) return;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
          },
        }],
      },
    });
  }

  async getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    if (lookbackDays !== undefined) {
      console.log(`[Sheets] Getting previously contacted names (lookback: ${lookbackDays} days)...`);
    } else {
      console.log('[Sheets] Getting all previously contacted names...');
    }
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Previously Contacted!A2:D',
    });
    const rows = response.data.values ?? [];
    const cutoff = lookbackDays !== undefined
      ? new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
      : undefined;
    const result = rows
      .map(row => ({
        name: ((row[0] as string) ?? '').trim(),
        lastContact: ((row[1] as string) ?? '').trim(),
      }))
      .filter(e => e.name && /^\d{4}-\d{2}-\d{2}$/.test(e.lastContact))
      .filter(e => cutoff === undefined || e.lastContact >= cutoff);
    console.log(`[Sheets] ${result.length} previously contacted entries returned.`);
    return result;
  }

  async addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    console.log(`[Sheets] Adding ${entry.name} to Previously Contacted tab...`);
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Previously Contacted!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[entry.name, entry.lastContact, entry.notes, entry.indeedId]] },
    });
  }

  async readOfferInfo(spreadsheetId: string): Promise<OfferInfo> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    console.log(`[Sheets] Reading Offer Info tab from spreadsheet ${spreadsheetId}...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Offer Info'!B2:B7",
    });
    const values = response.data.values ?? [];
    const cell = (row: number): string => ((values[row]?.[0] as string | undefined) ?? '').trim();
    return {
      email: cell(0),       // B2
      cellPhone: cell(1),   // B3
      startDate: cell(2),   // B4
      // B5 (index 3) is a spacer row — skipped
      rateOffered: cell(4), // B6
      justification: cell(5), // B7
    };
  }

  async addToTracker(lastName: string, firstName: string, startDate: string): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    console.log(`[Sheets] Adding ${lastName}, ${firstName} to Tracker tab...`);
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Tracker!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[lastName, firstName, 'Onboarding', startDate]] },
    });
  }
}
