import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

const COLUMNS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
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
      range: `${tab}!A:N`,
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
      range: 'Active!A:N',
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
      range: `Active!A${rowIndex + 1}:N${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:N',
    });
    const rows = response.data.values ?? [];
    return rows.map(row => {
      const candidate: Record<string, string> = {};
      COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
      return candidate as unknown as CandidateRow;
    });
  }

  async getEvaluatedCandidateIds(): Promise<Set<string>> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const ids = new Set<string>();
    const indeedIdCol = COLUMNS.indexOf('indeedId');

    for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A2:N`,
      });
      for (const row of response.data.values ?? []) {
        const id = (row[indeedIdCol] as string | undefined)?.trim();
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  async getCandidatesForAction(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:N',
    });
    const rows = response.data.values ?? [];
    const humanDecisionCol = COLUMNS.indexOf('humanDecision');
    return rows
      .filter(row => !!((row[humanDecisionCol] as string) ?? '').trim())
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
      range: `${fromTab}!A:N`,
    });
    const rows = readRes.data.values ?? [];
    const rowIndex = rows.findIndex((r, i) => i > 0 && (r[0] as string)?.trim() === name.trim());
    if (rowIndex === -1) return;

    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${toTab}!A:N`,
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
}
