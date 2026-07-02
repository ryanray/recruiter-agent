import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class FakeIndeedAdapter implements IndeedAdapter {
  private applicants: Applicant[] = [];
  private interviews: Interview[] = [];
  markedSentiments: { applicantId: string; sentiment: string }[] = [];
  interviewsSetUp: { applicantId: string; options: { message: string; hiringTeamEmails: string[] } }[] = [];
  statusesSet: { applicantId: string; status: string }[] = [];
  multiJobApplicantIds: Set<string> = new Set();

  seedApplicants(applicants: Applicant[]): void {
    this.applicants = applicants;
  }

  seedInterviews(interviews: Interview[]): void {
    this.interviews = interviews;
  }

  async getNewApplications(_since: Date): Promise<Applicant[]> {
    return [...this.applicants];
  }

  async fetchProfileData(profileUrl: string): Promise<{ text: string; otherJobCount: number }> {
    const idMatch = profileUrl.match(/[?&]id=([^&]+)/);
    const id = idMatch?.[1] ?? '';
    const otherJobCount = this.multiJobApplicantIds.has(id) ? 1 : 0;
    return { text: 'Fake profile text', otherJobCount };
  }

  async markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void> {
    this.markedSentiments.push({ applicantId, sentiment });
  }

  async setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void> {
    this.interviewsSetUp.push({ applicantId, options });
  }

  async getBookedInterviews(): Promise<Interview[]> {
    return this.interviews;
  }

  async downloadResume(applicantId: string): Promise<Buffer> {
    return Buffer.from(`Resume content for applicant ${applicantId}`);
  }

  async setStatus(applicantId: string, status: string): Promise<void> {
    this.statusesSet.push({ applicantId, status });
  }
}
