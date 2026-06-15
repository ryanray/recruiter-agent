import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { FakeIndeedAdapter } from '../src/fakes/indeed.fake.js';
import { FakeSheetsAdapter } from '../src/fakes/sheets.fake.js';
import { FakeDriveAdapter } from '../src/fakes/drive.fake.js';
import { FakeSlackAdapter } from '../src/fakes/slack.fake.js';
import type { Applicant, Config, ScreeningResult, CandidateRow } from '../src/types.js';

const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null },
  screening: {
    required: ['valid_license_and_transportation', 'within_30_miles_south_jordan'],
    preferred: ['cna_certification'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [], previously_contacted_lookback_days: 365 },
  messages: {
    interview_request: 'Hi {FIRST_NAME}, thanks for applying!',
  },
  google_drive: {
    recruiting_root_folder_id: 'root-id',
    awaiting_action_folder_id: 'awaiting-id',
    checkback_folder_id: 'checkback-id',
    rejected_folder_id: 'rejected-id',
    interview_template_sheet_id: 'template-id',
    run_log_doc_id: 'log-id',
  },
  google_sheets: { tracker_spreadsheet_id: 'sheet-id' },
  slack: { recruiting_channel: '#recruiting' },
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
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active']).toHaveLength(1);
    expect(sheets.tabs['Active'][0].status).toBe('Awaiting Review');
    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('PASS');
    expect(sheets.tabs['Active'][0].indeedId).toBe('app-1');
    expect(sheets.tabs['Active'][0].humanDecision).toBe('');
    expect(drive.folders[0].parentId).toBe('awaiting-id');
  });

  it('FAIL candidate still gets a Drive folder and Active row', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => failResult('Too far (40mi)'), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active']).toHaveLength(1);
    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('FAIL');
    expect(sheets.tabs['Active'][0].notes).toContain('Too far');
    expect(drive.folders).toHaveLength(1);
    expect(sheets.tabs['Rejected']).toHaveLength(0);
  });

  it('UNSURE candidate gets Active row and posts Slack alert', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => unsureResult('Cannot determine distance'), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].agentRecommendation).toBe('UNSURE');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].channel).toBe('#recruiting');
    expect(slack.messages[0].message).toContain('Review needed');
  });

  it('urgent PASS candidate posts Slack alert and still goes to Awaiting Review', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(true), config);

    await agent.evaluateCandidates(since, new Set(), () => {});

    expect(sheets.tabs['Active'][0].status).toBe('Awaiting Review');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Strong candidate');
  });

  it('skips candidates whose indeedId is already in Sheets', async () => {
    sheets.tabs['Active'].push(makeCandidate({ indeedId: 'app-1' }));
    indeed.seedApplicants([makeApplicant({ id: 'app-1' })]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(result.newApplicantsReviewed).toBe(0);
    expect(drive.folders).toHaveLength(0);
  });

  it('skips already-processed candidates (from state.json processedIds)', async () => {
    indeed.seedApplicants([makeApplicant({ id: 'already-done' }), makeApplicant({ id: 'new-one' })]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);
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
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), limitedConfig);

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
    }, config);

    const result = await agent.evaluateCandidates(since, new Set(), () => {});

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].description).toContain('Bad Actor');
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].name).toBe('Good Person');
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
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);
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
      expect(sheets.tabs['Active'][0].humanDecision).toBe('');
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
      expect(sheets.tabs['Active'][0].humanDecision).toBe('');
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
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);
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
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

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
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

      await agent.evaluateCandidates(since, new Set(), () => {});

      expect(slack.messages.filter(m => m.message.includes('Previously contacted'))).toHaveLength(0);
      expect(sheets.tabs['Active'][0].notes).not.toContain('[Previously contacted:');
    });

    it('processes normally when no prior contact record exists', async () => {
      indeed.seedApplicants([makeApplicant()]);
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

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
      const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

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
      agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);
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

describe('FakeSheetsAdapter new methods', () => {
  let sheets: FakeSheetsAdapter;

  beforeEach(() => { sheets = new FakeSheetsAdapter(); });

  it('getEvaluatedCandidateIds returns indeedIds from Active, Rejected, and Checkback Later', async () => {
    sheets.tabs['Active'].push(makeCandidate({ indeedId: 'id-1' }));
    sheets.tabs['Rejected'].push(makeCandidate({ indeedId: 'id-2' }));
    sheets.tabs['Checkback Later'].push(makeCandidate({ indeedId: 'id-3' }));
    const ids = await sheets.getEvaluatedCandidateIds();
    expect(ids.has('id-1')).toBe(true);
    expect(ids.has('id-2')).toBe(true);
    expect(ids.has('id-3')).toBe(true);
    expect(ids.size).toBe(3);
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
