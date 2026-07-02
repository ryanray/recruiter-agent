import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { FakeIndeedAdapter } from '../src/fakes/indeed.fake.js';
import { FakeSheetsAdapter } from '../src/fakes/sheets.fake.js';
import { FakeDriveAdapter } from '../src/fakes/drive.fake.js';
import { FakeSlackAdapter } from '../src/fakes/slack.fake.js';
import type { Applicant, Config, ScreeningResult, CandidateRow, ScoreResult } from '../src/types.js';

const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null, timeout_minutes: 90 },
  screening: {
    required: ['valid_license_and_transportation', 'within_30_miles_south_jordan'],
    preferred: ['cna_certification'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [], previously_contacted_lookback_days: 365, follow_up_days: 3 },
  messages: {
    interview_request: 'Hi {FIRST_NAME}, thanks for applying!',
    interview_follow_up_1: 'Hi {FIRST_NAME}, following up!',
    interview_follow_up_2: 'Hi {FIRST_NAME}, last follow-up!',
  },
  google_drive: {
    recruiting_root_folder_id: 'root-id',
    awaiting_action_folder_id: 'awaiting-id',
    checkback_folder_id: 'checkback-id',
    rejected_folder_id: 'rejected-id',
    never_responded_folder_id: 'never-responded-id',
    active_employees_folder_id: 'active-employees-id',
    interview_template_sheet_id: 'template-id',
    run_log_doc_id: 'log-id',
  },
  google_sheets: { tracker_spreadsheet_id: 'sheet-id' },
  slack: { recruiting_channel: '#recruiting' },
  indeed: { job_ids: ['test-job-1'] },
};

function makeCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    name: 'Jane Doe', phone: '801-555-1234', email: 'jane@example.com',
    indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
    indeedId: 'app-1', location: 'Sandy, UT',
    experience: 'home_care', certifications: '',
    agentRecommendation: 'PASS', status: 'Awaiting Review',
    lastContact: '2026-06-03', driveFolder: '', humanDecision: '', notes: '',
    ...overrides,
  };
}

function makeApplicant(overrides: Partial<Applicant> = {}): Applicant {
  return {
    id: 'app-1', name: 'Jane Doe', firstName: 'Jane', lastName: 'Doe',
    email: 'jane@example.com', phone: '801-555-1234', location: 'Sandy, UT',
    resumeText: 'CNA, 2 years home care',
    indeedProfileUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
    ...overrides,
  };
}

function passResult(isUrgent = false): ScreeningResult {
  return {
    decision: 'PASS', reasons: [],
    extractedData: {
      location: 'Sandy, UT', distanceMiles: 5, hasLicense: true, hasTransportation: true,
      certifications: isUrgent ? ['CNA'] : [],
      experienceTypes: ['home_care'], yearsExperience: isUrgent ? 2 : 1,
    },
    isUrgent,
  };
}

function failResult(reason: string): ScreeningResult {
  return {
    decision: 'FAIL', reasons: [reason],
    extractedData: {
      location: 'Provo, UT', distanceMiles: 35, hasLicense: true, hasTransportation: true,
      certifications: [], experienceTypes: [], yearsExperience: null,
    },
    isUrgent: false,
  };
}

function unsureResult(field: string): ScreeningResult {
  return {
    decision: 'UNSURE', reasons: [field],
    extractedData: {
      location: null, distanceMiles: null, hasLicense: null, hasTransportation: null,
      certifications: [], experienceTypes: [], yearsExperience: null,
    },
    isUrgent: false,
  };
}

function defaultScore(): ScoreResult {
  return {
    score: 75,
    recommendation: 'Interview',
    tier: 'Tier 2',
    keyStrengths: 'Home care experience',
    concerns: 'No dementia experience mentioned',
    interviewQuestions: 'Tell me about your experience',
  };
}

describe('Agent.run — Phase 1 (screen + Drive + Sheets)', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;
  const since = new Date('2026-01-01');

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
  });

  it('all evaluated candidates go to Active with Awaiting Review regardless of decision', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active']).toHaveLength(1);
    expect(sheets.tabs['Active'][0].status).toBe('Awaiting Review');
    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('PASS');
    expect(sheets.tabs['Active'][0].indeedId).toBe('app-1');
    expect(sheets.tabs['Active'][0].humanDecision).toBe('Approve'); // PASS + score 75 triggers auto-approve
    expect(drive.folders[0].parentId).toBe('awaiting-id');
  });

  it('FAIL candidate still gets a Drive folder and Active row', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => failResult('Too far (40mi)'), async () => defaultScore(), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active']).toHaveLength(1);
    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('FAIL');
    expect(sheets.tabs['Active'][0].notes).toContain('Too far');
    expect(drive.folders).toHaveLength(1);
    expect(sheets.tabs['Rejected']).toHaveLength(0);
  });

  it('UNSURE candidate gets Active row and posts Slack alert', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => unsureResult('Cannot determine distance'), async () => defaultScore(), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('UNSURE');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].channel).toBe('#recruiting');
    expect(slack.messages[0].message).toContain('Review needed');
  });

  it('urgent PASS candidate posts Slack alert and still goes to Awaiting Review', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(true), async () => defaultScore(), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].status).toBe('Awaiting Review');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Strong candidate');
  });

  it('skips candidate who applied to a second job when already on the sheet by name', async () => {
    sheets.tabs['Active'].push(makeCandidate({ name: 'Jane Doe', indeedId: 'app-first-job' }));
    indeed.seedApplicants([makeApplicant({ id: 'app-second-job', name: 'Jane Doe' })]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(result.newApplicantsReviewed).toBe(0);
    expect(drive.folders).toHaveLength(0);
  });

  it('skips candidates whose indeedId is already in Sheets', async () => {
    sheets.tabs['Active'].push(makeCandidate({ indeedId: 'app-1' }));
    indeed.seedApplicants([makeApplicant({ id: 'app-1' })]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(result.newApplicantsReviewed).toBe(0);
    expect(drive.folders).toHaveLength(0);
  });

  it('skips already-processed candidates (from state.json processedIds)', async () => {
    indeed.seedApplicants([makeApplicant({ id: 'already-done' }), makeApplicant({ id: 'new-one' })]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
    const alreadyProcessed = new Set(['already-done']);

    const result = await agent.evaluateCandidates(since, alreadyProcessed, () => {});

    expect(result.newApplicantsReviewed).toBe(1);
    expect(drive.folders).toHaveLength(1);
  });

  it('respects max_candidates_per_run', async () => {
    const limitedConfig = { ...config, run: { ...config.run, max_candidates_per_run: 2 } };
    indeed.seedApplicants([
      makeApplicant({ id: '1', name: 'A A', firstName: 'A', lastName: 'A' }),
      makeApplicant({ id: '2', name: 'B B', firstName: 'B', lastName: 'B' }),
      makeApplicant({ id: '3', name: 'C C', firstName: 'C', lastName: 'C' }),
    ]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), limitedConfig);

    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(result.newApplicantsReviewed).toBe(2);
    expect(result.remainingApplicants).toBe(1);
  });

  it('records an error and continues when a candidate throws', async () => {
    indeed.seedApplicants([
      makeApplicant({ id: 'bad', name: 'Bad Actor', firstName: 'Bad' }),
      makeApplicant({ id: 'good', name: 'Good Person', firstName: 'Good' }),
    ]);
    let callCount = 0;
    const agent = new Agent(indeed, sheets, drive, slack, async () => {
      callCount++;
      if (callCount === 1) throw new Error('Simulated Claude failure');
      return passResult();
    }, async () => defaultScore(), config);

    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].description).toContain('Bad Actor');
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].name).toBe('Good Person');
  });

  it('writes score fields to the Active sheet row', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const scorer = async (): Promise<ScoreResult> => ({
      score: 82,
      recommendation: 'Strong Interview',
      tier: 'Tier 1',
      keyStrengths: 'CNA with dementia experience',
      concerns: '',
      interviewQuestions: 'Describe a difficult client situation',
    });
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), scorer, config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    const row = sheets.tabs['Active'][0];
    expect(row.score).toBe('82');
    expect(row.scoreRecommendation).toBe('Strong Interview');
    expect(row.scoreTier).toBe('Tier 1');
    expect(row.keyStrengths).toBe('CNA with dementia experience');
    expect(row.scoreConcerns).toBe('');
    expect(row.interviewQuestions).toBe('Describe a difficult client situation');
  });

  it('auto-approves a PASS candidate with score > 50', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => ({ ...defaultScore(), score: 75 }), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].humanDecision).toBe('Approve');
  });

  it('does not auto-approve a PASS candidate with score <= 50', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => ({ ...defaultScore(), score: 50 }), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].humanDecision).toBe('');
  });

  it('does not auto-approve a FAIL candidate even with score > 50', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => failResult('Too far'), async () => ({ ...defaultScore(), score: 80 }), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].humanDecision).toBe('');
  });

  it('adds [PDF text extraction failed] to notes when PDF extraction returns empty', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
    indeed.downloadResume = async () => Buffer.from('');

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].notes).toContain('[PDF text extraction failed]');
  });

  describe('Agent.processPendingDecisions', () => {
    let indeed: FakeIndeedAdapter;
    let sheets: FakeSheetsAdapter;
    let drive: FakeDriveAdapter;
    let slack: FakeSlackAdapter;
    let agent: Agent;

    beforeEach(() => {
      indeed = new FakeIndeedAdapter();
      sheets = new FakeSheetsAdapter();
      drive = new FakeDriveAdapter();
      slack = new FakeSlackAdapter();
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
      // Pre-seed a folder so moves have something to reference
      drive.folders.push({ id: 'folder-1', name: 'Doe, Jane - 2026-06-03', parentId: 'awaiting-id' });
    });

    it('Approve: clears humanDecision first, marks yes sentiment, sets up interview, moves folder, updates status', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Approve',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(indeed.markedSentiments[0]).toEqual({ applicantId: 'app-1', sentiment: 'yes' });
      expect(indeed.interviewsSetUp).toHaveLength(1);
      expect(indeed.interviewsSetUp[0].applicantId).toBe('app-1');
      expect(indeed.interviewsSetUp[0].options.message).toContain('Jane');
      expect(indeed.interviewsSetUp[0].options.hiringTeamEmails).toEqual([]);
      expect(drive.moves[0].folderId).toBe('folder-1');
      expect(drive.moves[0].targetParentId).toBe('root-id');
      expect(sheets.tabs['Active'][0].status).toBe('Screened - Invite Sent');
      expect(sheets.tabs['Active'][0].humanDecision).toBe('None');
      expect(sheets.tabs['Active'][0].lastContact).toBeTruthy();
    });

    it('Reject: clears humanDecision first, marks no sentiment, moves folder and row (no message sent)', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Reject',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(indeed.markedSentiments[0]).toEqual({ applicantId: 'app-1', sentiment: 'no' });
      expect(indeed.interviewsSetUp).toHaveLength(0);
      expect(drive.moves[0].targetParentId).toBe('rejected-id');
      expect(sheets.tabs['Active']).toHaveLength(0);
      expect(sheets.tabs['Rejected']).toHaveLength(1);
    });

    it('Checkback Later: clears humanDecision first, marks yes sentiment, moves folder and row, sends no message', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Checkback Later',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(indeed.markedSentiments[0]).toEqual({ applicantId: 'app-1', sentiment: 'yes' });
      expect(drive.moves[0].targetParentId).toBe('checkback-id');
      expect(sheets.tabs['Active']).toHaveLength(0);
      expect(sheets.tabs['Checkback Later']).toHaveLength(1);
    });

    it('Hold: clears humanDecision first, posts Slack alert, no sentiment change, no folder move', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Hold', agentRecommendation: 'UNSURE',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
        notes: 'Cannot determine distance',
      }));

      await agent.processPendingDecisions();

      expect(indeed.markedSentiments).toHaveLength(0);
      expect(drive.moves).toHaveLength(0);
      expect(slack.messages).toHaveLength(1);
      expect(slack.messages[0].message).toContain('Jane Doe');
      expect(slack.messages[0].message).toContain('UNSURE');
      expect(slack.messages[0].message).toContain('Cannot determine distance');
      expect(slack.messages[0].message).toContain('https://employers.indeed.com/candidates/view?id=app-1');
      expect(sheets.tabs['Active'][0].humanDecision).toBe('None');
    });
  });

  describe('Agent.processBookedInterviews', () => {
    let indeed: FakeIndeedAdapter;
    let sheets: FakeSheetsAdapter;
    let drive: FakeDriveAdapter;
    let slack: FakeSlackAdapter;
    let agent: Agent;

    beforeEach(() => {
      indeed = new FakeIndeedAdapter();
      sheets = new FakeSheetsAdapter();
      drive = new FakeDriveAdapter();
      slack = new FakeSlackAdapter();
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
    });

    it('updates status, lastContact, and posts Slack when interview is booked', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', name: 'Jane Doe', status: 'Screened - Invite Sent',
      }));
      indeed.seedInterviews([{
        applicantId: 'app-1',
        applicantName: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
      }]);

      await agent.processBookedInterviews();

      expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
      expect(sheets.tabs['Active'][0].lastContact).toBeTruthy();
      expect(slack.messages).toHaveLength(1);
      expect(slack.messages[0].message).toContain('Jane Doe');
      expect(slack.messages[0].message).toContain('Thursday, June 5, 2026');
    });

    it('skips candidate already at Interview Scheduled', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', name: 'Jane Doe', status: 'Interview Scheduled',
      }));
      indeed.seedInterviews([{
        applicantId: 'app-1',
        applicantName: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
      }]);

      await agent.processBookedInterviews();

      expect(slack.messages).toHaveLength(0);
      expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
    });

    it('skips interview with no matching candidate in Active', async () => {
      indeed.seedInterviews([{
        applicantId: 'unknown-id',
        applicantName: 'Unknown Person',
        scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
      }]);

      await agent.processBookedInterviews();

      expect(slack.messages).toHaveLength(0);
    });

    it('processes multiple booked interviews', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', name: 'Jane Doe', status: 'Screened - Invite Sent',
      }));
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-2', name: 'John Smith', status: 'Screened - Invite Sent',
      }));
      indeed.seedInterviews([
        { applicantId: 'app-1', applicantName: 'Jane Doe', scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)' },
        { applicantId: 'app-2', applicantName: 'John Smith', scheduledAt: 'Friday, June 6, 2026 from 2:00 to 2:15 pm (MDT)' },
      ]);

      await agent.processBookedInterviews();

      expect(sheets.tabs['Active'][0].status).toBe('Interview Scheduled');
      expect(sheets.tabs['Active'][1].status).toBe('Interview Scheduled');
      expect(slack.messages).toHaveLength(2);
    });
  });

  describe('Agent.evaluateCandidates — previously contacted guard', () => {
    let indeed: FakeIndeedAdapter;
    let sheets: FakeSheetsAdapter;
    let drive: FakeDriveAdapter;
    let slack: FakeSlackAdapter;
    const since = new Date('2026-01-01');

    beforeEach(() => {
      indeed = new FakeIndeedAdapter();
      sheets = new FakeSheetsAdapter();
      drive = new FakeDriveAdapter();
      slack = new FakeSlackAdapter();
    });

    it('flags applicant with prior contact within window: notes prefixed + Slack alert', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      sheets.previouslyContacted.push({
        name: 'Jane Doe', lastContact: yesterday, notes: 'Rejected', indeedId: 'old-id',
      });
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      const priorAlert = slack.messages.find(m => m.message.includes('Previously contacted'));
      expect(priorAlert).toBeDefined();
      expect(priorAlert!.message).toContain('Jane Doe');
      expect(sheets.tabs['Active'][0].notes).toMatch(/^\[Previously contacted:/);
    });

    it('does not flag applicant with prior contact outside window', async () => {
      sheets.previouslyContacted.push({
        name: 'Jane Doe', lastContact: '2020-01-01', notes: 'Rejected', indeedId: 'old-id',
      });
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.filter(m => m.message.includes('Previously contacted'))).toHaveLength(0);
      expect(sheets.tabs['Active'][0].notes).not.toContain('[Previously contacted:');
    });

    it('processes normally when no prior contact record exists', async () => {
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.filter(m => m.message.includes('Previously contacted'))).toHaveLength(0);
      expect(sheets.tabs['Active'][0].notes).not.toContain('[Previously contacted:');
    });

    it('matches case-insensitively: lowercase name in tab matches mixed-case applicant', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      sheets.previouslyContacted.push({
        name: 'jane doe', lastContact: yesterday, notes: 'Rejected', indeedId: 'old-id',
      });
      indeed.seedApplicants([makeApplicant({ name: 'Jane Doe' })]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.find(m => m.message.includes('Previously contacted'))).toBeDefined();
    });
  });

  describe('Agent.processPendingDecisions — previously contacted write-back', () => {
    let indeed: FakeIndeedAdapter;
    let sheets: FakeSheetsAdapter;
    let drive: FakeDriveAdapter;
    let slack: FakeSlackAdapter;
    let agent: Agent;

    beforeEach(() => {
      indeed = new FakeIndeedAdapter();
      sheets = new FakeSheetsAdapter();
      drive = new FakeDriveAdapter();
      slack = new FakeSlackAdapter();
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
      drive.folders.push({ id: 'folder-1', name: 'Doe, Jane - 2026-06-03', parentId: 'awaiting-id' });
    });

    it('approve writes candidate to Previously Contacted tab', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Approve',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(sheets.previouslyContacted).toHaveLength(1);
      expect(sheets.previouslyContacted[0].name).toBe('Jane Doe');
      expect(sheets.previouslyContacted[0].notes).toBe('Approved - interview sent');
      expect(sheets.previouslyContacted[0].indeedId).toBe('app-1');
      expect(sheets.previouslyContacted[0].lastContact).toBeTruthy();
    });

    it('reject writes candidate to Previously Contacted tab', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Reject',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(sheets.previouslyContacted).toHaveLength(1);
      expect(sheets.previouslyContacted[0].name).toBe('Jane Doe');
      expect(sheets.previouslyContacted[0].notes).toBe('Rejected');
    });

    it('checkback later does not write to Previously Contacted', async () => {
      sheets.tabs['Active'].push(makeCandidate({
        indeedId: 'app-1', humanDecision: 'Checkback Later',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }));

      await agent.processPendingDecisions();

      expect(sheets.previouslyContacted).toHaveLength(0);
    });
  });
});

describe('Agent.processFollowUps', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;
  let agent: Agent;

  function staleCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    return makeCandidate({
      status: 'Screened - Invite Sent',
      indeedId: 'app-1',
      inviteCount: '1',
      lastContact: fourDaysAgo,
      driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      ...overrides,
    });
  }

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
    drive.folders.push({ id: 'folder-1', name: 'Doe, Jane - 2026-06-03', parentId: 'root-id' });
    agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
  });

  it('sends follow-up 1 when inviteCount=1 and past threshold', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '1' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(1);
    expect(indeed.interviewsSetUp[0].options.message).toContain('following up');
    const updated = sheets.tabs['Active'][0];
    expect(updated.inviteCount).toBe('2');
    expect(updated.lastContact).toBe(new Date().toISOString().slice(0, 10));
  });

  it('sends follow-up 2 when inviteCount=2 and past threshold', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '2' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(1);
    expect(indeed.interviewsSetUp[0].options.message).toContain('last follow-up');
    const updated = sheets.tabs['Active'][0];
    expect(updated.inviteCount).toBe('3');
  });

  it('moves to Never Responded when inviteCount=3 and past threshold', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '3' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(0);
    expect(drive.moves).toHaveLength(1);
    expect(drive.moves[0].targetParentId).toBe('never-responded-id');
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.tabs['Never Responded']).toHaveLength(1);
  });

  it('skips candidate within follow_up_days threshold', async () => {
    const yesterday = new Date(Date.now() - 1 * 86_400_000).toISOString().slice(0, 10);
    sheets.tabs['Active'].push(staleCandidate({ lastContact: yesterday }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(0);
    expect(sheets.tabs['Active'][0].inviteCount).toBe('1');
  });

  it('defaults inviteCount to 1 when field is missing', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: undefined }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp).toHaveLength(1);
    expect(indeed.interviewsSetUp[0].options.message).toContain('following up');
    expect(sheets.tabs['Active'][0].inviteCount).toBe('2');
  });

  it('uses interview_follow_up_1 message for first follow-up', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '1', name: 'Jane Doe' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp[0].options.message).toBe('Hi Jane, following up!');
  });

  it('uses interview_follow_up_2 message for second follow-up', async () => {
    sheets.tabs['Active'].push(staleCandidate({ inviteCount: '2', name: 'Jane Doe' }));

    await agent.processFollowUps();

    expect(indeed.interviewsSetUp[0].options.message).toBe('Hi Jane, last follow-up!');
  });

  it('logs error and continues when setupInterview throws for one candidate', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    sheets.tabs['Active'].push(staleCandidate({ name: 'Jane Doe', indeedId: 'bad-id', inviteCount: '1' }));
    sheets.tabs['Active'].push(makeCandidate({
      name: 'Bob Jones', indeedId: 'good-id',
      status: 'Screened - Invite Sent', inviteCount: '1', lastContact: fourDaysAgo,
    }));

    let callCount = 0;
    indeed.setupInterview = async (id) => {
      callCount++;
      if (id === 'bad-id') throw new Error('Indeed API error');
    };

    await agent.processFollowUps();

    expect(callCount).toBe(2);
    expect(sheets.tabs['Active'][1].inviteCount).toBe('2');
  });
});

describe('multi-job applicant detection', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;
  let agent: Agent;

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
    agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
  });

  it('adds Human Review row, posts Slack, populates humanReviewFlagged, skips Drive/scoring', async () => {
    const applicant = makeApplicant({
      id: 'app-multi',
      name: 'Multi Job',
      firstName: 'Multi',
      lastName: 'Job',
      indeedProfileUrl: 'https://employers.indeed.com/candidates/view?id=app-multi',
    });
    indeed.seedApplicants([applicant]);
    indeed.multiJobApplicantIds.add('app-multi');

    const result = await agent.evaluateCandidates(new Date(0));

    const row = sheets.tabs['Active'].find(c => c.name === 'Multi Job');
    expect(row).toBeDefined();
    expect(row!.status).toBe('Human Review');
    expect(row!.notes).toBe('Applied to 1 other job(s) on this account — human review required');
    expect(row!.indeedId).toBe('app-multi');
    expect(row!.humanDecision).toBe('');

    expect(drive.folders).toHaveLength(0);
    expect(drive.files).toHaveLength(0);
    expect(drive.copies).toHaveLength(0);
    expect(indeed.markedSentiments).toHaveLength(0);

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Multi Job');
    expect(slack.messages[0].message).toContain('1 other job(s)');
    expect(slack.messages[0].message).toContain('Human review needed');

    expect(result.humanReviewFlagged).toEqual(['Multi Job']);
  });

  it('normal candidate (otherJobCount=0) still goes through full pipeline', async () => {
    indeed.seedApplicants([makeApplicant()]);

    const result = await agent.evaluateCandidates(new Date(0));

    expect(result.humanReviewFlagged).toHaveLength(0);
    expect(drive.folders).toHaveLength(1);
  });

  it('processFollowUps flags Human Review candidate instead of sending follow-up', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      name: 'Follow Up Person',
      indeedId: 'app-fu',
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-fu',
      status: 'Screened - Invite Sent',
      lastContact: '2026-01-01',
      inviteCount: '1',
    }));
    indeed.multiJobApplicantIds.add('app-fu');

    const { followUpsSent } = await agent.processFollowUps();

    expect(followUpsSent).toHaveLength(0);
    expect(indeed.interviewsSetUp).toHaveLength(0);

    const row = sheets.tabs['Active'].find(c => c.name === 'Follow Up Person');
    expect(row!.status).toBe('Human Review');

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Follow Up Person');
    expect(slack.messages[0].message).toContain('Human review needed');
  });

  it('processFollowUps still sends follow-up when candidate has not applied to other jobs', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      name: 'Normal Follow Up',
      indeedId: 'app-normal',
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-normal',
      status: 'Screened - Invite Sent',
      lastContact: '2026-01-01',
      inviteCount: '1',
    }));
    // multiJobApplicantIds is empty — otherJobCount will be 0

    const { followUpsSent } = await agent.processFollowUps();

    expect(followUpsSent).toHaveLength(1);
    expect(indeed.interviewsSetUp).toHaveLength(1);
  });

  it('processPendingDecisions acts normally on Human Review candidate when humanDecision is set', async () => {
    sheets.tabs['Active'].push(makeCandidate({
      name: 'Doe, John',
      indeedId: 'app-hr',
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-hr',
      status: 'Human Review',
      humanDecision: 'Reject',
      driveFolder: '',
    }));

    await agent.processPendingDecisions();

    const rejectedRow = sheets.tabs['Rejected'].find(c => c.name === 'Doe, John');
    expect(rejectedRow).toBeDefined();
    expect(sheets.tabs['Active'].find(c => c.name === 'Doe, John')).toBeUndefined();
  });
});

describe('Agent — hire decision', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
  });

  function makeHireCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
    return {
      name: 'Ray, Ryan', phone: '801-555-1234', email: 'ryan@example.com',
      indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      indeedId: 'app-1', location: 'Sandy, UT',
      experience: 'home_care', certifications: '',
      agentRecommendation: 'PASS', status: 'Interview Scheduled',
      lastContact: '2026-06-15', driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      humanDecision: 'Hire', notes: '',
      ...overrides,
    };
  }

  function makeOfferInfo(overrides: Partial<import('../src/types.js').OfferInfo> = {}): import('../src/types.js').OfferInfo {
    return {
      email: 'ryan@example.com',
      cellPhone: '801-555-1234',
      startDate: '2026-07-15',
      rateOffered: '15',
      justification: '',
      ...overrides,
    };
  }

  it('full happy path: folder moved, offer info valid, Indeed status set, row moved to Hired, Tracker row appended', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo());
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(drive.moves).toContainEqual({ folderId: 'folder-1', targetParentId: 'active-employees-id' });
    expect(indeed.statusesSet).toContainEqual({ applicantId: 'app-1', status: 'Hired' });
    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.trackerRows).toContainEqual({ lastName: 'Ray', firstName: 'Ryan', startDate: '2026-07-15' });
    expect(sheets.tabs['Hired'][0].status).toBe('Onboarding');
    expect(slack.messages).toHaveLength(0);
  });

  it('posts Slack @here alert when offer info has missing fields, hire still completes', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo({ email: '', cellPhone: '' }));
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('@here');
    expect(slack.messages[0].message).toContain('Ray, Ryan');
    expect(slack.messages[0].message).toContain('Click here');
    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.trackerRows).toHaveLength(1);
  });

  it('includes justification in missing fields when rate > 16 and justification is blank', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo({ rateOffered: '17', justification: '' }));
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('justification');
  });

  it('does not flag justification as missing when rate is exactly 16', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo({ rateOffered: '16', justification: '' }));
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(0);
  });

  it('posts Slack alert about missing sheet when no spreadsheet found in folder, hire still completes', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    drive.spreadsheetInFolder = null;
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Ray, Ryan');
    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.trackerRows).toContainEqual({ lastName: 'Ray', firstName: 'Ryan', startDate: '' });
  });

  it('logs error and continues when setStatus throws — row still moved, Tracker still written', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo());
    indeed.setStatus = async () => { throw new Error('Indeed API error'); };
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(sheets.tabs['Hired']).toHaveLength(1);
    expect(sheets.trackerRows).toHaveLength(1);
  });

  it('logs error and skips Tracker when moveCandidate throws', async () => {
    sheets.tabs['Active'].push(makeHireCandidate());
    sheets.offerInfoBySpreadsheetId.set('fake-sheet-id', makeOfferInfo());
    sheets.moveCandidate = async () => { throw new Error('Sheets API error'); };
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);

    await agent.processPendingDecisions();

    expect(sheets.trackerRows).toHaveLength(0);
  });
});

describe('FakeSheetsAdapter new methods', () => {
  let sheets: FakeSheetsAdapter;

  beforeEach(() => { sheets = new FakeSheetsAdapter(); });

  it('getEvaluatedCandidates returns indeedIds and names from Active, Rejected, and Checkback Later', async () => {
    sheets.tabs['Active'].push(makeCandidate({ indeedId: 'id-1', name: 'Jane Doe' }));
    sheets.tabs['Rejected'].push(makeCandidate({ indeedId: 'id-2', name: 'John Smith' }));
    sheets.tabs['Checkback Later'].push(makeCandidate({ indeedId: 'id-3', name: 'Alice Brown' }));
    const { ids, names } = await sheets.getEvaluatedCandidates();
    expect(ids.has('id-1')).toBe(true);
    expect(ids.has('id-2')).toBe(true);
    expect(ids.has('id-3')).toBe(true);
    expect(ids.size).toBe(3);
    expect(names.has('jane doe')).toBe(true);
    expect(names.has('john smith')).toBe(true);
    expect(names.has('alice brown')).toBe(true);
  });

  it('getCandidatesForAction returns only Active rows with non-empty humanDecision', async () => {
    sheets.tabs['Active'].push(makeCandidate({ humanDecision: 'Approve' }));
    sheets.tabs['Active'].push(makeCandidate({ humanDecision: '' }));
    const rows = await sheets.getCandidatesForAction();
    expect(rows).toHaveLength(1);
    expect(rows[0].humanDecision).toBe('Approve');
  });

  it('moveCandidate copies row to destination tab and removes from source', async () => {
    sheets.tabs['Active'].push(makeCandidate({ name: 'Jane Doe', indeedId: 'app-1' }));
    await sheets.moveCandidate('Jane Doe', 'Active', 'Rejected');
    expect(sheets.tabs['Active']).toHaveLength(0);
    expect(sheets.tabs['Rejected']).toHaveLength(1);
    expect(sheets.tabs['Rejected'][0].name).toBe('Jane Doe');
  });
});
