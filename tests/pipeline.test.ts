import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { FakeIndeedAdapter } from '../src/fakes/indeed.fake.js';
import { FakeSheetsAdapter } from '../src/fakes/sheets.fake.js';
import { FakeDriveAdapter } from '../src/fakes/drive.fake.js';
import { FakeSlackAdapter } from '../src/fakes/slack.fake.js';
import type { Applicant, Config, ScreeningResult } from '../src/types.js';

const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null },
  screening: {
    required: ['valid_license_and_transportation', 'within_20_miles_south_jordan'],
    preferred: ['cna_certification'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [] },
  messages: {
    intro: 'Hi {name}, thanks for applying!',
    rejection: 'Hi {name}, we appreciate your interest.',
  },
  google_drive: {
    recruiting_root_folder_id: 'root-id',
    checkback_folder_id: 'checkback-id',
    rejected_folder_id: 'rejected-id',
    interview_template_sheet_id: 'template-id',
    run_log_doc_id: 'log-id',
  },
  google_sheets: { tracker_spreadsheet_id: 'sheet-id' },
  slack: { recruiting_channel: '#recruiting' },
};

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

  it('creates Drive folder, uploads resume, copies template, and adds to Active for PASS', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    const result = await agent.run(since);

    // Phase 2: messaging not yet implemented
    expect(indeed.sentMessages).toHaveLength(0);
    expect(indeed.triggeredSchedulers).toHaveLength(0);

    // Drive setup happens at screening time for PASS candidates
    expect(drive.folders).toHaveLength(1);
    expect(drive.folders[0].name).toMatch(/^Doe, Jane - \d{4}-\d{2}-\d{2}$/);
    expect(drive.folders[0].parentId).toBe('root-id');
    expect(drive.files).toHaveLength(1);
    expect(drive.files[0].name).toBe('resume.pdf');
    expect(drive.copies).toHaveLength(1);
    expect(drive.copies[0].templateId).toBe('template-id');

    expect(sheets.tabs['Active']).toHaveLength(1);
    expect(sheets.tabs['Active'][0].status).toBe('Screened - Invite Sent');
    expect(sheets.tabs['Active'][0].driveFolder).toContain('drive.google.com');
    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(slack.messages).toHaveLength(0);
  });

  it('adds to Rejected for FAIL — no Drive folder, no Slack alert', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => failResult('Too far (35mi)'), config);

    await agent.run(since);

    // Phase 2: messaging not yet implemented
    expect(indeed.sentMessages).toHaveLength(0);
    expect(drive.folders).toHaveLength(0); // no Drive folder for rejected candidates
    expect(sheets.tabs['Rejected']).toHaveLength(1);
    expect(sheets.tabs['Rejected'][0].notes).toContain('Too far');
    expect(slack.messages).toHaveLength(0);
  });

  it('adds to Active as UNSURE and posts to Slack', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => unsureResult('Cannot determine distance'), config);

    await agent.run(since);

    expect(sheets.tabs['Active'][0].status).toBe('UNSURE');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].channel).toBe('#recruiting');
    expect(slack.messages[0].message).toContain('Review needed');
  });

  it('posts Slack alert for urgent/strong candidate', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(true), config);

    await agent.run(since);

    expect(drive.folders).toHaveLength(1); // Drive folder still created
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Strong candidate');
  });

  it('skips already-processed candidates', async () => {
    indeed.seedApplicants([makeApplicant({ id: 'already-done' }), makeApplicant({ id: 'new-one' })]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);
    const alreadyProcessed = new Set(['already-done']);

    const result = await agent.run(since, alreadyProcessed);

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

    const result = await agent.run(since);

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

    const result = await agent.run(since);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].description).toContain('Bad Actor');
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].name).toBe('Good Person');
  });

  // TODO Phase 2: re-enable when interview scheduling is implemented
  // it('creates Drive folder, uploads resume, copies template, and posts Slack on booking', ...)

  // TODO Phase 2: re-enable when cold candidate follow-up is implemented
  // it('flags cold candidate and posts Slack alert', ...)
  // it('does not flag Interview Scheduled candidates as cold', ...)
});
