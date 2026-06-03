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
  scheduledAt: Date;
  indeedInterviewId: string;
}

export type CandidateStatus =
  | 'Awaiting Review'
  | 'Screened - Invite Sent'
  | 'Interview Scheduled'
  | 'Cold'
  | 'UNSURE'
  | 'Rejected';

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
  notes: string;
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

// --- Run result types ---

export interface RunCandidateResult {
  name: string;
  location: string;
  experience: string;
  certifications: string;
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
  configVersion: string;
  screeningCriteria: {
    required: string[];
    preferred: string[];
  };
}

// --- Adapter interfaces ---

export interface IndeedAdapter {
  getNewApplications(since: Date): Promise<Applicant[]>;
  fetchProfileText(profileUrl: string): Promise<string>;
  markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void>;
  sendMessage(applicantId: string, message: string): Promise<void>;
  triggerScheduler(applicantId: string, hiringTeamEmails: string[]): Promise<void>;
  getBookedInterviews(): Promise<Interview[]>;
  downloadResume(applicantId: string): Promise<Buffer>;
}

export interface SheetsAdapter {
  addCandidate(tab: string, candidate: CandidateRow): Promise<void>;
  updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void>;
  getActiveCandidates(): Promise<CandidateRow[]>;
  getEvaluatedCandidateIds(): Promise<Set<string>>;
  getCandidatesForAction(): Promise<CandidateRow[]>;
  moveCandidate(name: string, fromTab: string, toTab: string): Promise<void>;
}

export interface DriveAdapter {
  createFolder(name: string, parentId: string): Promise<string>;
  moveFolder(folderId: string, targetParentId: string): Promise<void>;
  uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void>;
  copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void>;
}

export interface SlackAdapter {
  post(channel: string, message: string): Promise<void>;
}

export type Screener = (applicant: Applicant, config: Config) => Promise<ScreeningResult>;

// --- Config type (mirrors config.yaml) ---

export interface Config {
  run: {
    trigger: 'manual' | 'cron';
    max_candidates_per_run: number | null;
  };
  screening: {
    required: string[];
    preferred: string[];
    disqualifying: string[];
  };
  scheduling: {
    cold_candidate_days: number;
    hiring_team_emails: string[];
  };
  messages: {
    intro: string;
    rejection: string;
  };
  google_drive: {
    recruiting_root_folder_id: string;
    awaiting_action_folder_id: string;
    checkback_folder_id: string;
    rejected_folder_id: string;
    interview_template_sheet_id: string;
    run_log_doc_id: string;
  };
  google_sheets: {
    tracker_spreadsheet_id: string;
  };
  slack: {
    recruiting_channel: string;
  };
}
