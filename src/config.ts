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
  ['messages', 'intro'],
  ['messages', 'rejection'],
  ['google_drive', 'recruiting_root_folder_id'],
  ['google_drive', 'checkback_folder_id'],
  ['google_drive', 'rejected_folder_id'],
  ['google_drive', 'interview_template_sheet_id'],
  ['google_drive', 'run_log_doc_id'],
  ['google_sheets', 'tracker_spreadsheet_id'],
  ['slack', 'recruiting_channel'],
];

function validateConfig(config: Config): void {
  for (const [section, key] of REQUIRED_FIELDS) {
    const value = (config as Record<string, Record<string, unknown>>)[section]?.[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required config: ${section}.${key}`);
    }
  }
}
