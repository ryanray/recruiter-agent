import { describe, it, expect } from 'vitest';
import { formatRunLog, formatCandidateSummary, formatActSummary } from '../src/logger.js';
import type { RunResult } from '../src/types.js';

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    startedAt: new Date('2026-06-01T10:00:00Z'),
    completedAt: new Date('2026-06-01T10:04:32Z'),
    durationMs: 272000,
    newApplicantsReviewed: 2,
    remainingApplicants: 3,
    passed: [{ name: 'Jane Doe', location: 'Sandy, UT', experience: 'home_care', certifications: 'CNA' }],
    rejected: [{ name: 'Tom Harris', location: 'Provo, UT', experience: '', certifications: '', reason: 'Too far (35mi)' }],
    unsure: [],
    bookings: [],
    coldCandidates: [],
    errors: [],
    pdfFailures: [],
    scoreFailures: [],
    followUpsSent: [],
    neverResponded: [],
    humanReviewFlagged: [],
    previouslyContacted: [],
    autoRejected: [],
    configVersion: 'abc1234',
    screeningCriteria: {
      required: ['within_20_miles_south_jordan', 'valid_license_and_transportation'],
      preferred: ['cna_certification'],
    },
    ...overrides,
  };
}

describe('formatRunLog', () => {
  it('includes the run timestamp and duration', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('2026-06-01 10:00');
    expect(log).toContain('4m 32s');
  });

  it('includes candidate counts and remaining', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('2 reviewed, 3 remaining');
  });

  it('marks passed candidates with a checkmark', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('✓ PASS');
    expect(log).toContain('Jane Doe');
  });

  it('marks rejected candidates with an X and reason', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('✗ REJECT');
    expect(log).toContain('Too far (35mi)');
  });

  it('includes config version', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('abc1234');
  });

  it('includes errors when present', () => {
    const result = makeResult({
      errors: [{ description: 'Drive folder failed for Jane', reason: 'Permission denied', action: 'Slack alert sent' }],
    });
    const log = formatRunLog(result);
    expect(log).toContain('Drive folder failed for Jane');
    expect(log).toContain('Permission denied');
  });

  it('renders human review flags with other-job count', () => {
    const log = formatRunLog(makeResult({
      humanReviewFlagged: [{ name: 'Multi Job', otherJobCount: 2, indeedUrl: 'https://employers.indeed.com/candidates/view?id=x' }],
    }));
    expect(log).toContain('Multi Job — applied to 2 other job(s)');
  });
});

describe('formatCandidateSummary', () => {
  it('renders human review flags with count and Indeed link', () => {
    const msg = formatCandidateSummary(makeResult({
      humanReviewFlagged: [{ name: 'Multi Job', otherJobCount: 2, indeedUrl: 'https://employers.indeed.com/candidates/view?id=x' }],
    }));
    expect(msg).toContain('*Flagged for Human Review (1):*');
    expect(msg).toContain('Multi Job — applied to 2 other job(s)  <https://employers.indeed.com/candidates/view?id=x|View in Indeed>');
  });

  it('renders unsure entries with an Indeed link', () => {
    const msg = formatCandidateSummary(makeResult({
      unsure: [{ name: 'Jane Doe', location: '', experience: '', certifications: '', unclearField: 'Cannot determine distance', indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1' }],
    }));
    expect(msg).toContain('? Jane Doe — Cannot determine distance');
    expect(msg).toContain('<https://employers.indeed.com/candidates/view?id=app-1|View in Indeed>');
  });

  it('renders previously contacted section with last-seen date and link', () => {
    const msg = formatCandidateSummary(makeResult({
      previouslyContacted: [{ name: 'Jane Doe', lastSeen: '2026-05-01', indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1' }],
    }));
    expect(msg).toContain('*Previously contacted (1):*');
    expect(msg).toContain('Jane Doe — last seen 2026-05-01  <https://employers.indeed.com/candidates/view?id=app-1|View in Indeed>');
  });
});

function makeActParams(overrides: Record<string, unknown> = {}) {
  return {
    actioned: [],
    holds: [],
    actionRequired: [],
    newlyBooked: [],
    followUpsSent: [],
    neverResponded: [],
    humanReviewFlagged: [],
    interviewResultsProcessed: [],
    inPersonReminders: [],
    ...overrides,
  };
}

describe('formatActSummary', () => {
  it('renders booked interviews with score and links', () => {
    const msg = formatActSummary(makeActParams({
      newlyBooked: [{
        name: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)',
        score: '82', tier: 'Tier 1',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
        driveFolder: 'https://drive.google.com/drive/folders/folder-1',
      }],
    }));
    expect(msg).toContain('*Interviews booked (1):*');
    expect(msg).toContain('Jane Doe — Thursday, June 5, 2026 from 10:00 to 10:15 am (MDT)  |  82/100 (Tier 1)');
    expect(msg).toContain('<https://employers.indeed.com/candidates/view?id=app-1|Open on Indeed>');
    expect(msg).toContain('<https://drive.google.com/drive/folders/folder-1|Open on Google Drive>');
  });

  it('omits score and Drive link when absent', () => {
    const msg = formatActSummary(makeActParams({
      newlyBooked: [{
        name: 'Jane Doe',
        scheduledAt: 'Thursday, June 5, 2026',
        indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1',
      }],
    }));
    expect(msg).toContain('Jane Doe — Thursday, June 5, 2026  |  <https://employers.indeed.com/candidates/view?id=app-1|Open on Indeed>');
    expect(msg).not.toContain('/100');
    expect(msg).not.toContain('Google Drive');
  });

  it('starts with <!here> and an Action required section when actionRequired is non-empty', () => {
    const msg = formatActSummary(makeActParams({
      actionRequired: [{ name: 'Ray, Ryan', issue: 'missing offer info (start date)', link: 'https://docs.google.com/spreadsheets/d/abc/edit' }],
    }));
    expect(msg.startsWith('<!here>')).toBe(true);
    expect(msg).toContain('🚨 Action required (1)');
    expect(msg).toContain('Ray, Ryan — missing offer info (start date)  <https://docs.google.com/spreadsheets/d/abc/edit|Open sheet>');
  });

  it('omits <!here> and still reports nothing to act on when everything is empty', () => {
    const msg = formatActSummary(makeActParams());
    expect(msg).not.toContain('<!here>');
    expect(msg).toContain('_Nothing to act on._');
  });

  it('renders holds with recommendation, notes, and Indeed link', () => {
    const msg = formatActSummary(makeActParams({
      holds: [{ name: 'Jane Doe', agentRecommendation: 'UNSURE', notes: 'Cannot determine distance', indeedUrl: 'https://employers.indeed.com/candidates/view?id=app-1' }],
    }));
    expect(msg).toContain('*🚩 Held for review (1):*');
    expect(msg).toContain('Jane Doe — Agent: UNSURE — Cannot determine distance  <https://employers.indeed.com/candidates/view?id=app-1|View in Indeed>');
    expect(msg).not.toContain('_Nothing to act on._');
  });
});
