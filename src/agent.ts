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

  async evaluateCandidates(
    since: Date,
    processedIds: Set<string> = new Set(),
    markProcessed: (id: string) => void = () => {},
  ): Promise<RunResult> {
    const startedAt = new Date();
    const result: RunResult = {
      startedAt, completedAt: startedAt, durationMs: 0,
      newApplicantsReviewed: 0, remainingApplicants: 0,
      passed: [], rejected: [], unsure: [],
      bookings: [], coldCandidates: [], errors: [],
      configVersion: getGitCommitHash(),
      screeningCriteria: {
        required: this.config.screening.required,
        preferred: this.config.screening.preferred,
      },
    };

    const evaluatedIds = await this.sheets.getEvaluatedCandidateIds();

    let applicants = (await this.indeed.getNewApplications(since))
      .filter(a => !processedIds.has(a.id) && !evaluatedIds.has(a.id));

    const limit = this.config.run.max_candidates_per_run;
    result.remainingApplicants = limit ? Math.max(0, applicants.length - limit) : 0;
    if (limit) applicants = applicants.slice(0, limit);
    result.newApplicantsReviewed = applicants.length;

    for (const applicant of applicants) {
      console.log(`\n[Agent] Processing: ${applicant.name} (${applicant.location ?? 'no location'})`);
      try {
        console.log(`[Agent] Fetching profile text for ${applicant.name}...`);
        try {
          applicant.resumeText = await this.indeed.fetchProfileText(applicant.indeedProfileUrl);
          console.log(`[Agent] Profile text fetched (${applicant.resumeText.length} chars).`);
        } catch (profileErr) {
          console.log(`[Agent] Could not fetch profile text: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
        }

        console.log(`[Agent] Screening ${applicant.name} with Claude...`);
        const screening = await this.screener(applicant, this.config);
        console.log(`[Agent] Decision: ${screening.decision}${screening.reasons.length ? ' — ' + screening.reasons.join('; ') : ''}`);

        const nameLabel = `${applicant.lastName}, ${applicant.firstName}`;
        const folderName = `${nameLabel} - ${today()}`;

        console.log(`[Agent] Creating Drive folder: "${folderName}"`);
        const folderId = await this.drive.createFolder(
          folderName,
          this.config.google_drive.awaiting_action_folder_id
        );

        console.log(`[Agent] Downloading and uploading resume...`);
        const resume = await this.indeed.downloadResume(applicant.id);
        await this.drive.uploadFile(folderId, 'resume.pdf', resume, 'application/pdf');

        console.log(`[Agent] Copying interview template...`);
        await this.drive.copyTemplate(
          this.config.google_drive.interview_template_sheet_id,
          folderId,
          `Interview Questions: ${nameLabel} - ${today()}`
        );

        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
        console.log(`[Agent] Drive folder ready: ${folderUrl}`);

        const row = this.buildRow(applicant, screening, 'Awaiting Review');
        row.driveFolder = folderUrl;
        row.agentRecommendation = screening.decision;
        row.humanDecision = '';
        row.indeedId = applicant.id;
        row.notes = screening.reasons.join('; ');

        console.log(`[Agent] Adding to Active sheet...`);
        await this.sheets.addCandidate('Active', row);

        if (screening.decision === 'PASS') {
          result.passed.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: screening.extractedData.experienceTypes.join(', '),
            certifications: screening.extractedData.certifications.join(', '),
          });
          if (screening.isUrgent) {
            console.log(`[Agent] Strong candidate — posting Slack alert.`);
            await this.slack.post(
              this.config.slack.recruiting_channel,
              `🚨 *Strong candidate:* ${applicant.name} — CNA + ${screening.extractedData.yearsExperience}yr experience\n${applicant.indeedProfileUrl}`
            );
          }
        } else if (screening.decision === 'FAIL') {
          result.rejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            reason: screening.reasons.join('; '),
          });
        } else {
          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            unclearField: screening.reasons.join('; '),
          });
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `❓ *Review needed:* ${applicant.name} — ${screening.reasons.join('; ')}\n${applicant.indeedProfileUrl}`
          );
        }

        console.log(`[Agent] Done with ${applicant.name}.`);
        markProcessed(applicant.id);

      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Agent] ERROR processing ${applicant.name}: ${reason}`);
        result.errors.push({
          description: `Failed to process ${applicant.name}`,
          reason,
          action: 'Candidate skipped — manual review needed',
        });
      }
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - startedAt.getTime();
    return result;
  }

  async processPendingDecisions(): Promise<void> {
    const candidates = await this.sheets.getCandidatesForAction();
    console.log(`\n[Agent] ${candidates.length} candidate(s) with pending human decisions.`);

    for (const candidate of candidates) {
      const decision = candidate.humanDecision.trim().toLowerCase();
      const folderId = candidate.driveFolder?.match(/folders\/([^/?]+)/)?.[1];
      const firstName = candidate.name.includes(',')
        ? candidate.name.split(',')[1]?.trim() ?? candidate.name
        : candidate.name.split(' ')[0] ?? candidate.name;
      const lastName = candidate.name.includes(',')
        ? candidate.name.split(',')[0]?.trim() ?? ''
        : candidate.name.split(' ').slice(1).join(' ');
      console.log(`[Agent] Acting on ${candidate.name}: ${candidate.humanDecision.trim()}`);

      try {
        if (decision === 'approve') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

          console.log(`[Agent] Marking sentiment "yes" on Indeed...`);
          await this.indeed.markSentiment(candidate.indeedId, 'yes');

          console.log(`[Agent] Setting up interview for ${candidate.name}...`);
          await this.indeed.setupInterview(candidate.indeedId, {
            message: renderTemplate(this.config.messages.interview_request, {
              FIRST_NAME: firstName,
              LAST_NAME: lastName,
            }),
            hiringTeamEmails: this.config.scheduling.hiring_team_emails,
          });

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to recruiting root...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.recruiting_root_folder_id);
          }

          await this.sheets.updateCandidateStatus(
            candidate.name, 'Screened - Invite Sent', { lastContact: today() }
          );

        } else if (decision === 'reject') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

          console.log(`[Agent] Marking sentiment "no" on Indeed (automated follow-up sends in 3 days)...`);
          await this.indeed.markSentiment(candidate.indeedId, 'no');

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to _Rejected...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.rejected_folder_id);
          }

          console.log(`[Agent] Moving row to Rejected tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Rejected');

        } else if (decision === 'checkback later') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

          console.log(`[Agent] Marking sentiment "yes" on Indeed...`);
          await this.indeed.markSentiment(candidate.indeedId, 'yes');

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to _Checkback Later...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.checkback_folder_id);
          }

          console.log(`[Agent] Moving row to Checkback Later tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Checkback Later');

        } else if (decision === 'hold') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name} and posting Slack alert...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `🚩 *Hold for review:* ${candidate.name} — Agent: ${candidate.agentRecommendation}\n${candidate.notes}\n${candidate.indeedUrl}`
          );
        } else {
          console.warn(`[Agent] Unrecognized humanDecision for ${candidate.name}: "${candidate.humanDecision.trim()}" — skipping. Valid values: Approve, Reject, Checkback Later, Hold`);
          continue;
        }

        console.log(`[Agent] Done acting on ${candidate.name}.`);
      } catch (err) {
        console.error(`[Agent] Error acting on ${candidate.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async processBookedInterviews(): Promise<void> {
    console.log('\n[Agent] Checking for booked interviews...');
    const interviews = await this.indeed.getBookedInterviews();
    console.log(`[Agent] ${interviews.length} booked interview(s) found on Indeed.`);

    const activeCandidates = await this.sheets.getActiveCandidates();
    const byIndeedId = new Map(activeCandidates.map(c => [c.indeedId, c]));

    for (const interview of interviews) {
      const candidate = byIndeedId.get(interview.applicantId);
      if (!candidate) {
        console.log(`[Agent] No matching candidate for applicantId=${interview.applicantId} — skipping.`);
        continue;
      }
      if (candidate.status === 'Interview Scheduled') {
        console.log(`[Agent] ${candidate.name} already at Interview Scheduled — skipping.`);
        continue;
      }
      console.log(`[Agent] Interview booked: ${candidate.name} — ${interview.scheduledAt}`);
      await this.sheets.updateCandidateStatus(candidate.name, 'Interview Scheduled', { lastContact: today() });
      await this.slack.post(
        this.config.slack.recruiting_channel,
        `🗓 *Interview scheduled:* ${candidate.name} — ${interview.scheduledAt}\n<${candidate.indeedUrl}|Open on Indeed>${candidate.driveFolder ? `  |  <${candidate.driveFolder}|Open on Google Drive>` : ''}`
      );
    }
  }

  async run(
    since: Date,
    processedIds: Set<string> = new Set(),
    markProcessed: (id: string) => void = () => {},
  ): Promise<RunResult> {
    const result = await this.evaluateCandidates(since, processedIds, markProcessed);
    await this.processPendingDecisions();
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
      indeedId: '',
      location: screening.extractedData.location ?? '',
      experience: screening.extractedData.experienceTypes.join(', '),
      certifications: screening.extractedData.certifications.join(', '),
      agentRecommendation: '',
      status,
      lastContact: today(),
      driveFolder: '',
      humanDecision: '',
      notes: '',
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
