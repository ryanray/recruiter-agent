import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import type { Config } from './types.js';

export function loadConfig(configPath = 'config.yaml'): Config {
  const raw = readFileSync(resolve(configPath), 'utf8');
  const parsed = yaml.load(raw) as Config;
  validateConfig(parsed);
  return parsed;
}

const REQUIRED_FIELDS: [string, string][] = [
  ['run', 'trigger'],
  ['screening', 'required'],
  ['scheduling', 'cold_candidate_days'],
  ['scheduling', 'previously_contacted_lookback_days'],
  ['scheduling', 'follow_up_days'],
  ['messages', 'interview_request'],
  ['messages', 'interview_follow_up_1'],
  ['messages', 'interview_follow_up_2'],
  ['google_drive', 'recruiting_root_folder_id'],
  ['google_drive', 'awaiting_action_folder_id'],
  ['google_drive', 'checkback_folder_id'],
  ['google_drive', 'rejected_folder_id'],
  ['google_drive', 'never_responded_folder_id'],
  ['google_drive', 'active_employees_folder_id'],
  ['google_drive', 'interview_template_sheet_id'],
  ['google_drive', 'run_log_doc_id'],
  ['google_sheets', 'tracker_spreadsheet_id'],
  ['slack', 'recruiting_channel'],
];

function validateConfig(config: Config): void {
  if (!config || typeof config !== 'object') {
    throw new Error('Config file is empty or not a valid YAML object');
  }
  for (const [section, key] of REQUIRED_FIELDS) {
    const value = (config as Record<string, Record<string, unknown>>)[section]?.[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required config: ${section}.${key}`);
    }
  }
  const trigger = (config as Record<string, Record<string, unknown>>)['run']?.['trigger'];
  if (trigger !== 'manual' && trigger !== 'cron') {
    throw new Error(`Invalid value for run.trigger: must be 'manual' or 'cron', got '${trigger}'`);
  }
  const jobIds = (config as Record<string, Record<string, unknown>>)['indeed']?.['job_ids'];
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    throw new Error('Missing required config: indeed.job_ids (must be a non-empty list of Indeed job IDs)');
  }
}
