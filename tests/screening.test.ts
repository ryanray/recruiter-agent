import { describe, it, expect } from 'vitest';
import { applyRules } from '../src/screening.js';
import type { ExtractedProfile, Config } from '../src/types.js';

const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null },
  screening: {
    required: ['valid_license_and_transportation', 'within_30_miles_south_jordan'],
    preferred: ['cna_certification', 'home_care_experience'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3, hiring_team_emails: [] },
  messages: { intro: '', rejection: '' },
  google_drive: {
    recruiting_root_folder_id: 'x', checkback_folder_id: 'x',
    rejected_folder_id: 'x', interview_template_sheet_id: 'x', run_log_doc_id: 'x',
  },
  google_sheets: { tracker_spreadsheet_id: 'x' },
  slack: { recruiting_channel: '#recruiting' },
};

function makeProfile(overrides: Partial<ExtractedProfile> = {}): ExtractedProfile {
  return {
    location: 'Sandy, UT',
    distanceMiles: 5,
    hasLicense: true,
    hasTransportation: true,
    certifications: [],
    experienceTypes: ['home_care'],
    yearsExperience: 1,
    ...overrides,
  };
}

describe('applyRules', () => {
  it('returns PASS for a candidate who meets all required criteria', () => {
    const result = applyRules(makeProfile(), config);
    expect(result.decision).toBe('PASS');
    expect(result.reasons).toHaveLength(0);
  });

  it('returns FAIL when candidate is too far away', () => {
    const result = applyRules(makeProfile({ distanceMiles: 35 }), config);
    expect(result.decision).toBe('FAIL');
    expect(result.reasons[0]).toContain('35 miles');
  });

  it('returns UNSURE when distance cannot be determined', () => {
    const result = applyRules(makeProfile({ distanceMiles: null }), config);
    expect(result.decision).toBe('UNSURE');
    expect(result.reasons[0]).toContain('distance');
  });

  it('returns FAIL when candidate has no license', () => {
    const result = applyRules(makeProfile({ hasLicense: false }), config);
    expect(result.decision).toBe('FAIL');
    expect(result.reasons[0]).toContain('license');
  });

  it('returns UNSURE when license info is missing', () => {
    const result = applyRules(makeProfile({ hasLicense: null }), config);
    expect(result.decision).toBe('UNSURE');
  });

  it('FAIL takes precedence over UNSURE', () => {
    const result = applyRules(makeProfile({ distanceMiles: 35, hasLicense: null }), config);
    expect(result.decision).toBe('FAIL');
  });

  it('sets isUrgent=true for CNA with 1+ year home care experience', () => {
    const result = applyRules(makeProfile({ certifications: ['CNA'], yearsExperience: 2 }), config);
    expect(result.isUrgent).toBe(true);
  });

  it('sets isUrgent=true for CNA with care facility experience', () => {
    const result = applyRules(
      makeProfile({ certifications: ['CNA'], experienceTypes: ['care_facility'], yearsExperience: 1 }),
      config
    );
    expect(result.isUrgent).toBe(true);
  });

  it('sets isUrgent=false when no CNA', () => {
    const result = applyRules(makeProfile({ certifications: [], yearsExperience: 5 }), config);
    expect(result.isUrgent).toBe(false);
  });

  it('sets isUrgent=false when CNA but less than 1 year experience', () => {
    const result = applyRules(makeProfile({ certifications: ['CNA'], yearsExperience: 0 }), config);
    expect(result.isUrgent).toBe(false);
  });

  it('passes candidates with only family care experience', () => {
    const result = applyRules(makeProfile({ experienceTypes: ['family'] }), config);
    expect(result.decision).toBe('PASS');
  });

  it('passes candidates with no experience (not a disqualifier)', () => {
    const result = applyRules(makeProfile({ experienceTypes: ['none'] }), config);
    expect(result.decision).toBe('PASS');
  });

  it('returns FAIL when distance is null and license is false (FAIL overwrites UNSURE)', () => {
    const result = applyRules(makeProfile({ distanceMiles: null, hasLicense: false }), config);
    expect(result.decision).toBe('FAIL');
    expect(result.reasons.some(r => r.includes('distance'))).toBe(true);
    expect(result.reasons.some(r => r.includes('license'))).toBe(true);
  });
});
