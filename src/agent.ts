import type {
  IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
  Screener, Config, RunResult, CandidateRow, CandidateStatus,
} from './types.js';
import { renderTemplate } from './messages.js';
import { getGitCommitHash } from './logger.js';

export class Agent {
  constructor(
    private indeed: IndeedAdapter,
    private sheets: SheetsAdapter,
    private drive: DriveAdapter,
    private slack: SlackAdapter,
    private screener: Screener,
    private config: Config,
  ) {}

  async run(since: Date): Promise<RunResult> {
    const startedAt = new Date();
    const result: RunResult = {
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      newApplicantsReviewed: 0,
      remainingApplicants: 0,
      passed: [], rejected: [], unsure: [],
      bookings: [], coldCandidates: [], errors: [],
      configVersion: getGitCommitHash(),
      screeningCriteria: {
        required: this.config.screening.required,
        preferred: this.config.screening.preferred,
      },
    };

    // Step 1: screen new applicants
    let applicants = await this.indeed.getNewApplications(since);
    const limit = this.config.run.max_candidates_per_run;
    result.remainingApplicants = limit ? Math.max(0, applicants.length - limit) : 0;
    if (limit) applicants = applicants.slice(0, limit);
    result.newApplicantsReviewed = applicants.length;

    for (const applicant of applicants) {
      try {
        const screening = await this.screener(applicant, this.config);

        if (screening.decision === 'PASS') {
          await this.indeed.sendMessage(
            applicant.id,
            renderTemplate(this.config.messages.intro, { name: applicant.firstName })
          );
          await this.indeed.triggerScheduler(applicant.id);

          await this.sheets.addCandidate('Active', this.buildRow(applicant, screening, 'Screened - Invite Sent'));

          result.passed.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: screening.extractedData.experienceTypes.join(', '),
            certifications: screening.extractedData.certifications.join(', '),
          });

          if (screening.isUrgent) {
            await this.slack.post(
              this.config.slack.recruiting_channel,
              `🚨 *Strong candidate:* ${applicant.name} — CNA + ${screening.extractedData.yearsExperience}yr experience\n${applicant.indeedProfileUrl}`
            );
          }

        } else if (screening.decision === 'FAIL') {
          await this.indeed.sendMessage(
            applicant.id,
            renderTemplate(this.config.messages.rejection, { name: applicant.firstName })
          );

          const row = this.buildRow(applicant, screening, 'Rejected');
          row.notes = screening.reasons.join('; ');
          await this.sheets.addCandidate('Rejected', row);

          result.rejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            reason: screening.reasons.join('; '),
          });

        } else {
          const row = this.buildRow(applicant, screening, 'UNSURE');
          row.notes = screening.reasons.join('; ');
          await this.sheets.addCandidate('Active', row);

          await this.slack.post(
            this.config.slack.recruiting_channel,
            `❓ *Review needed:* ${applicant.name} — ${screening.reasons.join('; ')}\n${applicant.indeedProfileUrl}`
          );

          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            unclearField: screening.reasons.join('; '),
          });
        }

      } catch (err) {
        result.errors.push({
          description: `Failed to process ${applicant.name}`,
          reason: err instanceof Error ? err.message : String(err),
          action: 'Candidate skipped — manual review needed',
        });
      }
    }

    // Step 2: handle new interview bookings
    const interviews = await this.indeed.getBookedInterviews();
    for (const interview of interviews) {
      try {
        const nameParts = interview.applicantName.split(' ');
        const folderName = `${nameParts.slice(1).join('_')}_${nameParts[0]}_${today()}`;
        const folderId = await this.drive.createFolder(
          folderName,
          this.config.google_drive.recruiting_root_folder_id
        );

        const resume = await this.indeed.downloadResume(interview.applicantId);
        await this.drive.uploadFile(folderId, 'resume.pdf', resume, 'application/pdf');

        await this.drive.copyTemplate(
          this.config.google_drive.interview_template_sheet_id,
          folderId,
          'Interview Questions'
        );

        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

        await this.sheets.updateCandidateStatus(interview.applicantName, 'Interview Scheduled', {
          driveFolder: folderUrl,
          lastContact: today(),
        });

        await this.slack.post(
          this.config.slack.recruiting_channel,
          `📅 *Interview scheduled:* ${interview.applicantName}\nTime: ${interview.scheduledAt.toLocaleString()}\nFolder: ${folderUrl}`
        );

        result.bookings.push({
          name: interview.applicantName,
          scheduledAt: interview.scheduledAt,
          driveFolderUrl: folderUrl,
        });

      } catch (err) {
        result.errors.push({
          description: `Failed to set up Drive folder for ${interview.applicantName}`,
          reason: err instanceof Error ? err.message : String(err),
          action: 'Slack alert sent, candidate stays Active without folder link',
        });
        await this.slack.post(
          this.config.slack.recruiting_channel,
          `⚠️ *Drive folder creation failed* for ${interview.applicantName}. Manual setup needed.`
        ).catch((alertErr: unknown) => {
          result.errors.push({
            description: `Slack alert also failed for ${interview.applicantName}`,
            reason: alertErr instanceof Error ? alertErr.message : String(alertErr),
            action: 'Manual intervention needed',
          });
        });
      }
    }

    // Step 3: check for cold candidates
    const active = await this.sheets.getActiveCandidates();
    const coldDays = this.config.scheduling.cold_candidate_days;
    const now = new Date();

    for (const candidate of active) {
      if (candidate.status !== 'Screened - Invite Sent') continue;
      const lastContact = new Date(candidate.lastContact);
      const daysSince = Math.floor((now.getTime() - lastContact.getTime()) / 86_400_000);

      if (daysSince >= coldDays) {
        await this.sheets.updateCandidateStatus(candidate.name, 'Cold');
        await this.slack.post(
          this.config.slack.recruiting_channel,
          `❄️ *Cold candidate:* ${candidate.name} — no response in ${daysSince} days\n${candidate.indeedUrl}`
        );
        result.coldCandidates.push({ name: candidate.name, daysSinceContact: daysSince });
      }
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - startedAt.getTime();
    return result;
  }

  private buildRow(
    applicant: { name: string; phone?: string; email?: string; indeedProfileUrl: string },
    screening: { extractedData: { location?: string | null; experienceTypes: string[]; certifications: string[] } },
    status: CandidateStatus
  ): CandidateRow {
    return {
      name: applicant.name,
      phone: applicant.phone ?? '',
      email: applicant.email ?? '',
      indeedUrl: applicant.indeedProfileUrl,
      location: screening.extractedData.location ?? '',
      experience: screening.extractedData.experienceTypes.join(', '),
      certifications: screening.extractedData.certifications.join(', '),
      status,
      lastContact: today(),
      notes: '',
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
