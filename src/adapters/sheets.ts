import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

const COLUMNS = ['name','phone','email','indeedUrl','location','experience','certifications','status','lastContact','driveFolder','notes'] as const;

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
      range: `${tab}!A:K`,
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
    const range = `Active!A:K`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId, range,
    });
    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex(r => r[0]?.trim() === name.trim());
    if (rowIndex === -1) return;

    const row = rows[rowIndex];
    const statusCol = COLUMNS.indexOf('status');
    const driveFolderCol = COLUMNS.indexOf('driveFolder');
    const lastContactCol = COLUMNS.indexOf('lastContact');

    row[statusCol] = status;
    if (extras?.driveFolder) row[driveFolderCol] = extras.driveFolder;
    if (extras?.lastContact) row[lastContactCol] = extras.lastContact;

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Active!A${rowIndex + 1}:K${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:K',
    });
    const rows = response.data.values ?? [];
    return rows.map(row => {
      const candidate: Record<string, string> = {};
      COLUMNS.forEach((col, i) => { candidate[col] = row[i] ?? ''; });
      return candidate as unknown as CandidateRow;
    });
  }
}
