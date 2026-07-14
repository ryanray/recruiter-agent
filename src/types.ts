// --- Domain types ---

export interface Applicant {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  location?: string;
  resumeText?: string;
  // appliedAt: Date;
  indeedProfileUrl: string;
}

export interface Interview {
  applicantId: string;
  applicantName: string;
  scheduledAt: string;
}

export interface PreviouslyContactedEntry {
  name: string;
  lastContact: string; // YYYY-MM-DD
  notes: string;
  indeedId: string; // empty string for seeded rows
}

export interface OfferInfo {
  email: string;
  cellPhone: string;
  startDate: string;
  rateOffered: string;
  justification: string;
}

export type CandidateStatus =
  | 'Awaiting Review'
  | 'Screened - Invite Sent'
  | 'Interview Scheduled'
  | 'In-Person Interview Scheduled'
  | 'Cold'
  | 'UNSURE'
  | 'Rejected'
  | 'Never Responded'
  | 'Onboarding'
  | 'Human Review';

export type EventType =
  | 'applicant_added'
  | 'invite_sent'
  | 'follow_up_sent'
  | 'phone_no_show'
  | 'in_person_no_show'
  | 'hired';

export interface CandidateRow {
  name: string;
  phone: string;
  email: string;
  indeedUrl: string;
  indeedId: string;
  location: string;
  experience: string;
  certifications: string;
  agentRecommendation: string;
  status: CandidateStatus;
  lastContact: string;
  driveFolder?: string;
  humanDecision: string;
  phoneInterviewResult?: string;       // "Passed" | "Failed" | "No-Show" | ""
  inPersonInterviewResult?: string;    // "Hired" | "Rejected" | "No-Show" | ""
  notes: string;
  score?: string;
  scoreRecommendation?: string;
  scoreTier?: string;
  keyStrengths?: string;
  scoreConcerns?: string;
  interviewQuestions?: string;
  processedAt?: string;
  inviteSentAt?: string;
  interviewScheduledAt?: string;
  inviteCount?: string;
  inPersonInterviewScheduledAt?: string;  // YYYY-MM-DD, set by Chandler when phone passes
  createdAt?: string;
}

export type ExperienceType = 'home_care' | 'care_facility' | 'family' | 'none';

export interface ExtractedProfile {
  location: string | null;
  distanceMiles: number | null;
  hasLicense: boolean | null;
  hasTransportation: boolean | null;
  certifications: string[];
  experienceTypes: ExperienceType[];
  yearsExperience: number | null;
}

export interface ScreeningResult {
  decision: 'PASS' | 'FAIL' | 'UNSURE';
  reasons: string[];
  extractedData: ExtractedProfile;
  isUrgent: boolean;
}

export interface ScoreResult {
  score: number;
  recommendation: 'Strong Interview' | 'Interview' | 'Maybe' | 'Pass';
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
  keyStrengths: string;
  concerns: string;
  interviewQuestions: string;
}

// --- Run result types ---

export interface RunCandidateResult {
  name: string;
  location: string;
  experience: string;
  certifications: string;
  score?: number;
  tier?: string;
  reason?: string;
  unclearField?: string;
}

export interface RunBookingResult {
  name: string;
  scheduledAt: Date;
  driveFolderUrl: string;
}

export interface RunColdResult {
  name: string;
  daysSinceContact: number;
}

export interface RunError {
  description: string;
  reason: string;
  action: string;
}

export interface RunResult {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  newApplicantsReviewed: number;
  remainingApplicants: number;
  passed: RunCandidateResult[];
  rejected: RunCandidateResult[];
  unsure: RunCandidateResult[];
  bookings: RunBookingResult[];
  coldCandidates: RunColdResult[];
  errors: RunError[];
  pdfFailures: string[];
  scoreFailures: string[];
  followUpsSent: { name: string; inviteCount: number }[];
  neverResponded: string[];
  humanReviewFlagged: string[];
  autoRejected: RunCandidateResult[];
  configVersion: string;
  screeningCriteria: {
    required: string[];
    preferred: string[];
  };
}

// --- Adapter interfaces ---

export interface IndeedAdapter {
  getNewApplications(since: Date): Promise<Applicant[]>;
  fetchProfileData(profileUrl: string): Promise<{ text: string; otherJobCount: number }>;
  markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void>;
  setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void>;
  getBookedInterviews(): Promise<Interview[]>;
  downloadResume(applicantId: string): Promise<Buffer>;
  setStatus(applicantId: string, status: string): Promise<void>;
}

export interface SheetsAdapter {
  addCandidate(tab: string, candidate: CandidateRow): Promise<void>;
  updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void>;
  getActiveCandidates(): Promise<CandidateRow[]>;
  getEvaluatedCandidates(): Promise<{ ids: Set<string>; names: Set<string> }>;
  getCandidatesForAction(): Promise<CandidateRow[]>;
  moveCandidate(name: string, fromTab: string, toTab: string): Promise<void>;
  getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]>;
  addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void>;
  readOfferInfo(spreadsheetId: string): Promise<OfferInfo>;
  addToTracker(lastName: string, firstName: string, startDate: string): Promise<void>;
  logEvent(candidate: string, event: EventType, detail?: string): Promise<void>;
}

export interface DriveAdapter {
  createFolder(name: string, parentId: string): Promise<string>;
  moveFolder(folderId: string, targetParentId: string): Promise<void>;
  uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void>;
  copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void>;
  listSubfolders(parentId: string): Promise<{ id: string; name: string }[]>;
  findSpreadsheetInFolder(folderId: string): Promise<{ id: string; name: string } | null>;
}

export interface SlackAdapter {
  post(channel: string, message: string): Promise<void>;
}

export type Screener = (applicant: Applicant, config: Config) => Promise<ScreeningResult>;

export type Scorer = (applicant: Applicant, config: Config) => Promise<ScoreResult>;

// --- Config type (mirrors config.yaml) ---

export interface Config {
  run: {
    trigger: 'manual' | 'cron';
    max_candidates_per_run: number | null;
    timeout_minutes: number;
  };
  screening: {
    required: string[];
    preferred: string[];
    disqualifying: string[];
  };
  scheduling: {
    cold_candidate_days: number;
    hiring_team_emails: string[];
    previously_contacted_lookback_days: number;
    follow_up_days: number;
  };
  messages: {
    interview_request: string;
    interview_follow_up_1: string;
    interview_follow_up_2: string;
  };
  google_drive: {
    recruiting_root_folder_id: string;
    awaiting_action_folder_id: string;
    checkback_folder_id: string;
    rejected_folder_id: string;
    never_responded_folder_id: string;
    active_employees_folder_id: string;
    interview_template_sheet_id: string;
    run_log_doc_id: string;
  };
  scoring: {
    auto_reject_below: number | null;
  };
  interview_results: {
    in_person_reminder_days: number;
  };
  google_sheets: {
    tracker_spreadsheet_id: string;
  };
  slack: {
    recruiting_channel: string;
  };
  indeed: {
    job_ids: string[];
  };
}
