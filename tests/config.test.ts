import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { loadConfig } from '../src/config.js';

const TEST_CONFIG_PATH = 'test-config.yaml';

const validYaml = `
run:
  trigger: manual
  max_candidates_per_run: 10
screening:
  required:
    - valid_license_and_transportation
    - within_20_miles_south_jordan
  preferred:
    - cna_certification
  disqualifying: []
scheduling:
  cold_candidate_days: 3
messages:
  intro: "Hi {name}, thanks!"
  rejection: "Hi {name}, no thanks."
google_drive:
  recruiting_root_folder_id: "root-id"
  checkback_folder_id: "checkback-id"
  rejected_folder_id: "rejected-id"
  interview_template_sheet_id: "template-id"
  run_log_doc_id: "log-id"
google_sheets:
  tracker_spreadsheet_id: "sheet-id"
slack:
  recruiting_channel: "#recruiting"
`;

beforeEach(() => writeFileSync(TEST_CONFIG_PATH, validYaml));
afterEach(() => { if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH); });

describe('loadConfig', () => {
  it('parses a valid config file', () => {
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.run.trigger).toBe('manual');
    expect(config.run.max_candidates_per_run).toBe(10);
    expect(config.screening.required).toContain('within_20_miles_south_jordan');
    expect(config.scheduling.cold_candidate_days).toBe(3);
    expect(config.slack.recruiting_channel).toBe('#recruiting');
  });

  it('throws when a required field is missing', () => {
    writeFileSync(TEST_CONFIG_PATH, validYaml.replace('recruiting_root_folder_id: "root-id"', 'recruiting_root_folder_id: ""'));
    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow('google_drive.recruiting_root_folder_id');
  });

  it('allows null max_candidates_per_run', () => {
    writeFileSync(TEST_CONFIG_PATH, validYaml.replace('max_candidates_per_run: 10', 'max_candidates_per_run: ~'));
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.run.max_candidates_per_run).toBeNull();
  });
});
