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
    // Implemented in Task 5
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
