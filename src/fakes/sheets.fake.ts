import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

export class FakeSheetsAdapter implements SheetsAdapter {
  tabs: Record<string, CandidateRow[]> = {
    Active: [],
    Rejected: [],
    Hired: [],
    'Checkback Later': [],
    'Communication Log': [],
  };

  async addCandidate(tab: string, candidate: CandidateRow): Promise<void> {
    if (!this.tabs[tab]) this.tabs[tab] = [];
    this.tabs[tab].push({ ...candidate });
  }

  async updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void> {
    const candidate = this.tabs['Active'].find(c => c.name === name);
    if (candidate) {
      candidate.status = status;
      if (extras) Object.assign(candidate, extras);
    }
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    return [...this.tabs['Active']];
  }
}
