import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class FakeIndeedAdapter implements IndeedAdapter {
  private applicants: Applicant[] = [];
  private interviews: Interview[] = [];
  sentMessages: { applicantId: string; message: string }[] = [];
  triggeredSchedulers: { applicantId: string; hiringTeamEmails: string[] }[] = [];

  seedApplicants(applicants: Applicant[]): void {
    this.applicants = applicants;
  }

  seedInterviews(interviews: Interview[]): void {
    this.interviews = interviews;
  }

  async getNewApplications(since: Date): Promise<Applicant[]> {
    return this.applicants.filter(a => a.appliedAt > since);
  }

  async sendMessage(applicantId: string, message: string): Promise<void> {
    this.sentMessages.push({ applicantId, message });
  }

  async triggerScheduler(applicantId: string, hiringTeamEmails: string[]): Promise<void> {
    this.triggeredSchedulers.push({ applicantId, hiringTeamEmails });
  }

  async getBookedInterviews(): Promise<Interview[]> {
    return this.interviews;
  }

  async downloadResume(applicantId: string): Promise<Buffer> {
    return Buffer.from(`Resume content for applicant ${applicantId}`);
  }
}
