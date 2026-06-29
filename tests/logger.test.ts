import { describe, it, expect } from 'vitest';
import { formatRunLog } from '../src/logger.js';
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
});
