import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class FakeIndeedAdapter implements IndeedAdapter {
  private applicants: Applicant[] = [];
  private interviews: Interview[] = [];
  markedSentiments: { applicantId: string; sentiment: string }[] = [];
  interviewsSetUp: { applicantId: string; options: { message: string; hiringTeamEmails: string[] } }[] = [];

  seedApplicants(applicants: Applicant[]): void {
    this.applicants = applicants;
  }

  seedInterviews(interviews: Interview[]): void {
    this.interviews = interviews;
  }

  async getNewApplications(_since: Date): Promise<Applicant[]> {
    return [...this.applicants];
  }

  async fetchProfileText(_profileUrl: string): Promise<string> {
    return 'Fake profile text';
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
}
