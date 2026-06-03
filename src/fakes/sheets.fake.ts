import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

export class FakeSheetsAdapter implements SheetsAdapter {
  tabs: Record<string, CandidateRow[]> = {
    Active: [], Rejected: [], Hired: [],
    'Checkback Later': [], 'Communication Log': [],
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

  async getEvaluatedCandidateIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
      for (const row of this.tabs[tab] ?? []) {
        if (row.indeedId) ids.add(row.indeedId);
      }
    }
    return ids;
  }

  async getCandidatesForAction(): Promise<CandidateRow[]> {
    return this.tabs['Active'].filter(c => !!c.humanDecision?.trim());
  }

  async moveCandidate(name: string, fromTab: string, toTab: string): Promise<void> {
    const idx = this.tabs[fromTab]?.findIndex(c => c.name === name) ?? -1;
    if (idx === -1) return;
    const [row] = this.tabs[fromTab].splice(idx, 1);
    if (!this.tabs[toTab]) this.tabs[toTab] = [];
    this.tabs[toTab].push(row);
  }
}
