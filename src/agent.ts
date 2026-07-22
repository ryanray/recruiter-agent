import type {
  IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
  Screener, Scorer, Config, RunResult, CandidateRow, CandidateStatus, OfferInfo, EventType, HumanReviewFlag, BookedInterviewNotice, HoldNotice, ActionRequiredItem,
} from './types.js';
import { extractPdfText } from './pdf.js';
import { renderTemplate } from './messages.js';
import { getGitCommitHash } from './logger.js';

export class Agent {
  constructor(
    private indeed: IndeedAdapter,
    private sheets: SheetsAdapter,
    private drive: DriveAdapter,
    private slack: SlackAdapter,
    private screener: Screener,
    private scorer: Scorer,
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
      pdfFailures: [], scoreFailures: [],
      followUpsSent: [], neverResponded: [],
      humanReviewFlagged: [],
      previouslyContacted: [],
      autoRejected: [],
      configVersion: getGitCommitHash(),
      screeningCriteria: {
        required: this.config.screening.required,
        preferred: this.config.screening.preferred,
      },
    };

    const { ids: evaluatedIds, names: evaluatedNames } = await this.sheets.getEvaluatedCandidates();

    let applicants = (await this.indeed.getNewApplications(since))
      .filter(a => {
        if (processedIds.has(a.id) || evaluatedIds.has(a.id)) return false;
        if (evaluatedNames.has(a.name.toLowerCase())) {
          console.log(`[Agent] Skipping ${a.name} — already on sheet (likely applied to multiple jobs).`);
          return false;
        }
        return true;
      });

    const limit = this.config.run.max_candidates_per_run;
    result.remainingApplicants = limit ? Math.max(0, applicants.length - limit) : 0;
    if (limit) applicants = applicants.slice(0, limit);
    result.newApplicantsReviewed = applicants.length;

    console.log(`[Agent] Loading previously contacted candidates (lookback: ${this.config.scheduling.previously_contacted_lookback_days} days)...`);
    const previouslyContactedEntries = await this.sheets.getPreviouslyContactedNames(
      this.config.scheduling.previously_contacted_lookback_days
    );
    const priorContactMap = new Map(
      previouslyContactedEntries.map(e => [e.name.toLowerCase(), e.lastContact])
    );
    console.log(`[Agent] ${priorContactMap.size} previously contacted candidate(s) in window.`);

    for (const applicant of applicants) {
      console.log(`\n[Agent] Processing: ${applicant.name} (${applicant.location ?? 'no location'})`);
      try {
        console.log(`[Agent] Fetching profile data for ${applicant.name}...`);
        let profileFetchResult: { text: string; otherJobCount: number } = { text: '', otherJobCount: 0 };
        try {
          profileFetchResult = await this.indeed.fetchProfileData(applicant.indeedProfileUrl);
          applicant.resumeText = profileFetchResult.text;
          console.log(`[Agent] Profile text fetched (${applicant.resumeText.length} chars), otherJobCount=${profileFetchResult.otherJobCount}.`);
        } catch (profileErr) {
          console.log(`[Agent] Could not fetch profile data: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
        }

        if (profileFetchResult.otherJobCount > 0) {
          console.log(`[Agent] ${applicant.name} has applied to ${profileFetchResult.otherJobCount} other job(s) — flagging for human review.`);
          const row: CandidateRow = {
            name: applicant.name,
            phone: applicant.phone ?? '',
            email: applicant.email ?? '',
            indeedUrl: applicant.indeedProfileUrl,
            indeedId: applicant.id,
            location: applicant.location ?? '',
            experience: '',
            certifications: '',
            agentRecommendation: '',
            status: 'Human Review',
            lastContact: today(),
            driveFolder: '',
            humanDecision: '',
            notes: `Applied to ${profileFetchResult.otherJobCount} other job(s) on this account — human review required`,
            processedAt: today(),
            createdAt: todayMMDDYYYY(),
          };
          await this.sheets.addCandidate('Active', row);
          await this.safeLogEvent(applicant.name, 'applicant_added');
          result.humanReviewFlagged.push({
            name: applicant.name,
            otherJobCount: profileFetchResult.otherJobCount,
            indeedUrl: applicant.indeedProfileUrl,
          });
          markProcessed(applicant.id);
          continue;
        }

        const priorContact = priorContactMap.get(applicant.name.toLowerCase());
        if (priorContact) {
          console.log(`[Agent] ${applicant.name} was previously contacted on ${priorContact} — flagging for human review.`);
          result.previouslyContacted.push({
            name: applicant.name,
            lastSeen: priorContact,
            indeedUrl: applicant.indeedProfileUrl,
          });
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

        console.log(`[Agent] Extracting PDF text for ${applicant.name}...`);
        const { text: pdfText, method: pdfMethod } = await extractPdfText(resume);
        let pdfNote = '';
        if (pdfMethod === 'none') {
          console.log(`[Agent] PDF text extraction failed for ${applicant.name} (pdf-parse and Claude both failed).`);
          result.pdfFailures.push(applicant.name);
          pdfNote = '[PDF text extraction failed] ';
        } else {
          console.log(`[Agent] PDF text extracted via ${pdfMethod} (${pdfText.length} chars).`);
        }

        console.log(`[Agent] Scoring ${applicant.name}...`);
        const profileText = applicant.resumeText ?? '';
        const combinedText = [
          profileText ? `--- Indeed Profile ---\n${profileText}` : '',
          pdfText ? `--- Resume (PDF) ---\n${pdfText}` : '',
        ].filter(Boolean).join('\n\n');
        const applicantForScoring = { ...applicant, resumeText: combinedText };
        let score;
        try {
          score = await this.scorer(applicantForScoring, this.config);
          console.log(`[Agent] Score: ${score.score}/100 — ${score.recommendation} (${score.tier})`);
        } catch (scoreErr) {
          console.error(`[Agent] Scoring failed for ${applicant.name}: ${scoreErr instanceof Error ? scoreErr.message : scoreErr}`);
          result.scoreFailures.push(applicant.name);
          score = { score: 0, recommendation: 'Pass' as const, tier: 'Tier 4' as const, keyStrengths: '', concerns: '', interviewQuestions: '' };
        }

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
        const autoApprove = screening.decision === 'PASS' && score.score > 50;
        row.humanDecision = autoApprove ? 'Approve' : '';
        row.indeedId = applicant.id;
        if (autoApprove) {
          console.log(`[Agent] Auto-approving ${applicant.name} (score: ${score.score}/100, PASS) — will send interview invite on next act run.`);
        }
        const priorNote = priorContact ? `[Previously contacted: ${priorContact}] ` : '';
        row.notes = `${priorNote}${pdfNote}${screening.reasons.join('; ')}`;
        row.score = String(score.score);
        row.scoreRecommendation = score.recommendation;
        row.scoreTier = score.tier;
        row.keyStrengths = score.keyStrengths;
        row.scoreConcerns = score.concerns;
        row.interviewQuestions = score.interviewQuestions;

        const autoRejectThreshold = this.config.scoring?.auto_reject_below ?? null;
        const autoReject = !autoApprove && autoRejectThreshold !== null && score.score < autoRejectThreshold;
        if (autoReject) {
          row.humanDecision = 'Reject';
          row.notes = `[AUTO-REJECTED: score ${score.score}/100 below threshold of ${autoRejectThreshold}] ${row.notes}`.trim();
          console.log(`[Agent] Auto-rejecting ${applicant.name} (score: ${score.score}/100 < threshold ${autoRejectThreshold}).`);
        }

        console.log(`[Agent] Adding to Active sheet...`);
        await this.sheets.addCandidate('Active', row);
        await this.safeLogEvent(applicant.name, 'applicant_added');

        if (autoReject) {
          result.autoRejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            score: score.score,
            tier: score.tier,
            reason: `score ${score.score}/100 below threshold of ${autoRejectThreshold}`,
          });
        } else if (screening.decision === 'PASS') {
          result.passed.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: screening.extractedData.experienceTypes.join(', '),
            certifications: screening.extractedData.certifications.join(', '),
            score: score.score,
            tier: score.tier,
          });
          if (screening.isUrgent) {
            console.log(`[Agent] Strong candidate — will appear in run summary.`);
          }
        } else if (screening.decision === 'FAIL') {
          result.rejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            score: score.score,
            tier: score.tier,
            reason: screening.reasons.join('; '),
          });
        } else {
          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            score: score.score,
            tier: score.tier,
            unclearField: screening.reasons.join('; '),
            indeedUrl: applicant.indeedProfileUrl,
          });
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

  async processPendingDecisions(): Promise<{
    actioned: { name: string; decision: string }[];
    holds: HoldNotice[];
    actionRequired: ActionRequiredItem[];
  }> {
    const actioned: { name: string; decision: string }[] = [];
    const holds: HoldNotice[] = [];
    const actionRequired: ActionRequiredItem[] = [];
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
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });

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
            candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteSentAt: today(), inviteCount: '1' }
          );
          await this.safeLogEvent(candidate.name, 'invite_sent');

          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (approved).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Approved - interview sent',
            indeedId: candidate.indeedId,
          });

        } else if (decision === 'reject') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });

          console.log(`[Agent] Marking sentiment "no" on Indeed (automated follow-up sends in 3 days)...`);
          await this.indeed.markSentiment(candidate.indeedId, 'no');

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to _Rejected...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.rejected_folder_id);
          }

          console.log(`[Agent] Moving row to Rejected tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Rejected');

          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (rejected).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Rejected',
            indeedId: candidate.indeedId,
          });

        } else if (decision === 'checkback later') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });

          console.log(`[Agent] Marking sentiment "yes" on Indeed...`);
          await this.indeed.markSentiment(candidate.indeedId, 'yes');

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to _Checkback Later...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.checkback_folder_id);
          }

          console.log(`[Agent] Moving row to Checkback Later tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Checkback Later');

        } else if (decision === 'hold') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name} (Hold — flagged in run summary)...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });
          holds.push({
            name: candidate.name,
            agentRecommendation: candidate.agentRecommendation,
            notes: candidate.notes,
            indeedUrl: candidate.indeedUrl,
          });
        } else if (decision === 'hire') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });

          // Step 1: Move Drive folder to Active Employees
          if (folderId) {
            console.log(`[Agent] Moving Drive folder to Active Employees...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.active_employees_folder_id);
          } else {
            console.warn(`[Agent] No Drive folder found for ${candidate.name} — skipping folder move.`);
          }

          // Step 2: Validate Offer Info tab
          let offerInfo: OfferInfo | null = null;
          const spreadsheet = folderId
            ? await this.drive.findSpreadsheetInFolder(folderId)
            : null;

          if (!spreadsheet) {
            console.warn(`[Agent] No spreadsheet found in folder for ${candidate.name} — skipping Offer Info check.`);
            actionRequired.push({
              name: candidate.name,
              issue: 'could not find interview questions sheet — please verify their Drive folder',
            });
          } else {
            console.log(`[Agent] Reading Offer Info tab...`);
            offerInfo = await this.sheets.readOfferInfo(spreadsheet.id);
            const missingFields = validateOfferInfo(offerInfo);
            if (missingFields.length > 0) {
              console.warn(`[Agent] Missing offer info for ${candidate.name}: ${missingFields.join(', ')}`);
              const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.id}/edit`;
              actionRequired.push({
                name: candidate.name,
                issue: `missing offer info (${missingFields.join(', ')})`,
                link: sheetUrl,
              });
            } else {
              console.log(`[Agent] Offer info valid — start date: ${offerInfo.startDate}, rate: $${offerInfo.rateOffered}/hr`);
            }
          }

          // Step 3: Set Indeed status to Hired (non-fatal if it fails)
          console.log(`[Agent] Setting Indeed status to Hired...`);
          try {
            await this.indeed.setStatus(candidate.indeedId, 'Hired');
          } catch (err) {
            console.error(`[Agent] Failed to set Indeed status for ${candidate.name}: ${err instanceof Error ? err.message : err}`);
          }

          // Step 4: Move row to Hired tab (fatal — if this fails, skip Tracker)
          console.log(`[Agent] Moving row to Hired tab...`);
          await this.sheets.updateCandidateStatus(candidate.name, 'Onboarding');
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Hired');
          await this.safeLogEvent(candidate.name, 'hired');

          // Step 5: Add to Tracker
          console.log(`[Agent] Adding ${candidate.name} to Tracker...`);
          await this.sheets.addToTracker(lastName, firstName, offerInfo?.startDate ?? '');
        } else if (decision === 'none') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name} (None — no action).`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });
        } else if (decision === 'do not contact') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name} (Do Not Contact — no action).`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: 'None' });
        } else {
          console.warn(`[Agent] Unrecognized humanDecision for ${candidate.name}: "${candidate.humanDecision.trim()}" — skipping. Valid values: Approve, Reject, Checkback Later, Hold, Hire, None, Do Not Contact`);
          continue;
        }

        actioned.push({ name: candidate.name, decision: candidate.humanDecision.trim() });
        console.log(`[Agent] Done acting on ${candidate.name}.`);
      } catch (err) {
        console.error(`[Agent] Error acting on ${candidate.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { actioned, holds, actionRequired };
  }

  async processBookedInterviews(): Promise<{ newlyBooked: BookedInterviewNotice[] }> {
    console.log('\n[Agent] Checking for booked interviews...');
    const interviews = await this.indeed.getBookedInterviews();
    console.log(`[Agent] ${interviews.length} booked interview(s) found on Indeed.`);

    const activeCandidates = await this.sheets.getActiveCandidates();
    const byIndeedId = new Map(activeCandidates.map(c => [c.indeedId, c]));
    const newlyBooked: BookedInterviewNotice[] = [];

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
      await this.sheets.updateCandidateStatus(candidate.name, 'Interview Scheduled', { lastContact: today(), interviewScheduledAt: today() });
      newlyBooked.push({
        name: candidate.name,
        scheduledAt: interview.scheduledAt,
        score: candidate.score,
        tier: candidate.scoreTier,
        indeedUrl: candidate.indeedUrl,
        driveFolder: candidate.driveFolder,
      });
    }
    return { newlyBooked };
  }

  async processInterviewResults(): Promise<{
    processed: { name: string; result: string; action: string }[];
    inPersonReminders: string[];
  }> {
    console.log('\n[Agent] Checking for interview results to process...');
    const candidates = await this.sheets.getActiveCandidates();
    const processed: { name: string; result: string; action: string }[] = [];
    const inPersonReminders: string[] = [];
    const reminderDays = this.config.interview_results.in_person_reminder_days;

    for (const candidate of candidates) {
      try {
        const phoneResult = (candidate.phoneInterviewResult ?? '').trim();
        const inPersonResult = (candidate.inPersonInterviewResult ?? '').trim();
        const isBlank = (v: string) => !v || v.toLowerCase() === 'none';

        if (candidate.status === 'Interview Scheduled' && !isBlank(phoneResult)) {
          if (phoneResult === 'Passed') {
            console.log(`[Agent] ${candidate.name} — phone interview Passed → In-Person Interview Scheduled`);
            await this.sheets.updateCandidateStatus(
              candidate.name,
              'In-Person Interview Scheduled',
              { inPersonInterviewScheduledAt: today() }
            );
            processed.push({ name: candidate.name, result: 'Passed', action: 'In-Person Interview Scheduled' });
          } else if (phoneResult === 'Failed' || phoneResult === 'No-Show') {
            console.log(`[Agent] ${candidate.name} — phone interview ${phoneResult} → queuing Reject`);
            await this.sheets.updateCandidateStatus(
              candidate.name,
              candidate.status,
              { humanDecision: 'Reject' }
            );
            if (phoneResult === 'No-Show') {
              await this.safeLogEvent(candidate.name, 'phone_no_show');
            }
            processed.push({ name: candidate.name, result: phoneResult, action: 'Set humanDecision=Reject' });
          }
        }

        if (candidate.status === 'In-Person Interview Scheduled' && !isBlank(inPersonResult)) {
          if (inPersonResult === 'Hired') {
            console.log(`[Agent] ${candidate.name} — in-person interview Hired → queuing Hire`);
            await this.sheets.updateCandidateStatus(
              candidate.name,
              candidate.status,
              { humanDecision: 'Hire' }
            );
            processed.push({ name: candidate.name, result: 'Hired', action: 'Set humanDecision=Hire' });
          } else if (inPersonResult === 'Rejected' || inPersonResult === 'No-Show') {
            console.log(`[Agent] ${candidate.name} — in-person interview ${inPersonResult} → queuing Reject`);
            await this.sheets.updateCandidateStatus(
              candidate.name,
              candidate.status,
              { humanDecision: 'Reject' }
            );
            if (inPersonResult === 'No-Show') {
              await this.safeLogEvent(candidate.name, 'in_person_no_show');
            }
            processed.push({ name: candidate.name, result: inPersonResult, action: 'Set humanDecision=Reject' });
          }
        }

        // Reminder check: in-person stage started but no result yet and deadline has passed
        if (
          candidate.status === 'In-Person Interview Scheduled' &&
          isBlank(inPersonResult) &&
          candidate.inPersonInterviewScheduledAt
        ) {
          const daysSince = Math.floor(
            (Date.now() - new Date(candidate.inPersonInterviewScheduledAt).getTime()) / 86_400_000
          );
          if (daysSince > reminderDays) {
            inPersonReminders.push(candidate.name);
          }
        }
      } catch (err) {
        console.error(`[Agent] Error processing interview result for ${candidate.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`[Agent] Interview results processed: ${processed.length}, reminders: ${inPersonReminders.length}`);
    return { processed, inPersonReminders };
  }

  async processFollowUps(): Promise<{ followUpsSent: { name: string; inviteCount: number }[]; neverResponded: string[]; humanReviewFlagged: HumanReviewFlag[] }> {
    console.log('\n[Agent] Checking for candidates needing follow-up...');
    const candidates = await this.sheets.getActiveCandidates();
    const pending = candidates.filter(c => c.status === 'Screened - Invite Sent');
    console.log(`[Agent] ${pending.length} candidate(s) at Screened - Invite Sent.`);

    const followUpsSent: { name: string; inviteCount: number }[] = [];
    const neverResponded: string[] = [];
    const humanReviewFlagged: HumanReviewFlag[] = [];
    const thresholdDays = this.config.scheduling.follow_up_days;

    for (const candidate of pending) {
      try {
        if (!candidate.lastContact) {
          console.warn(`[Agent] ${candidate.name} — no lastContact date, skipping.`);
          continue;
        }

        const daysSince = Math.floor(
          (Date.now() - new Date(candidate.lastContact).getTime()) / 86_400_000
        );

        if (daysSince < thresholdDays) {
          console.log(`[Agent] ${candidate.name} — last contact ${daysSince} day(s) ago, threshold is ${thresholdDays} — skipping.`);
          continue;
        }

        console.log(`[Agent] Checking for multi-job application for ${candidate.name}...`);
        try {
          const { otherJobCount } = await this.indeed.fetchProfileData(candidate.indeedUrl);
          if (otherJobCount > 0) {
            console.log(`[Agent] ${candidate.name} has applied to ${otherJobCount} other job(s) — flagging for human review instead of sending follow-up.`);
            await this.sheets.updateCandidateStatus(candidate.name, 'Human Review');
            humanReviewFlagged.push({
              name: candidate.name,
              otherJobCount,
              indeedUrl: candidate.indeedUrl,
            });
            continue;
          }
        } catch (profileErr) {
          console.log(`[Agent] Could not check multi-job status for ${candidate.name}: ${profileErr instanceof Error ? profileErr.message : profileErr} — proceeding with follow-up.`);
        }

        const inviteCount = parseInt(candidate.inviteCount ?? '1', 10) || 1;
        const firstName = candidate.name.includes(',')
          ? candidate.name.split(',')[1]?.trim() ?? candidate.name
          : candidate.name.split(' ')[0] ?? candidate.name;
        const folderId = candidate.driveFolder?.match(/folders\/([^/?]+)/)?.[1];

        if (inviteCount >= 3) {
          console.log(`[Agent] ${candidate.name} — inviteCount=${inviteCount} — no response after 3 invites, moving to Never Responded.`);
          if (folderId) {
            console.log(`[Agent] Moving Drive folder to Never Responded...`);
            try {
              await this.drive.moveFolder(folderId, this.config.google_drive.never_responded_folder_id);
            } catch (folderErr) {
              console.warn(`[Agent] Could not move Drive folder for ${candidate.name} (${folderId}) — folder may need to be moved manually: ${folderErr instanceof Error ? folderErr.message : folderErr}`);
            }
          }
          console.log(`[Agent] Moving row to Never Responded tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Never Responded');
          neverResponded.push(candidate.name);
          continue;
        }

        const messageTemplate = inviteCount === 1
          ? this.config.messages.interview_follow_up_1
          : this.config.messages.interview_follow_up_2;
        const nextCount = inviteCount + 1;

        console.log(`[Agent] ${candidate.name} — last contact ${daysSince} day(s) ago, inviteCount=${inviteCount} — sending follow-up ${inviteCount}.`);
        await this.indeed.setupInterview(candidate.indeedId, {
          message: renderTemplate(messageTemplate, { FIRST_NAME: firstName }),
          hiringTeamEmails: this.config.scheduling.hiring_team_emails,
        });

        await this.sheets.updateCandidateStatus(
          candidate.name, 'Screened - Invite Sent', { lastContact: today(), inviteCount: String(nextCount) }
        );
        await this.safeLogEvent(candidate.name, 'follow_up_sent', String(inviteCount));

        followUpsSent.push({ name: candidate.name, inviteCount: nextCount });
        console.log(`[Agent] Follow-up ${inviteCount} sent to ${candidate.name} (inviteCount now ${nextCount}).`);

      } catch (err) {
        console.error(`[Agent] Error processing follow-up for ${candidate.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { followUpsSent, neverResponded, humanReviewFlagged };
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

  private async safeLogEvent(candidate: string, event: EventType, detail?: string): Promise<void> {
    try {
      await this.sheets.logEvent(candidate, event, detail);
    } catch (err) {
      console.warn(`[Agent] Failed to log event ${event} for ${candidate}: ${err instanceof Error ? err.message : err}`);
    }
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
      processedAt: today(),
      createdAt: todayMMDDYYYY(),
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayMMDDYYYY(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

function validateOfferInfo(info: OfferInfo): string[] {
  const missing: string[] = [];
  if (!info.email) missing.push('email');
  if (!info.cellPhone) missing.push('cell phone');
  if (!info.startDate) missing.push('start date');
  if (!info.rateOffered) missing.push('rate offered');
  if (info.rateOffered && parseFloat(info.rateOffered) > 16 && !info.justification) {
    missing.push('justification (rate > $16)');
  }
  return missing;
}
