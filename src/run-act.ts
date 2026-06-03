import 'dotenv/config';
import { loadConfig } from './config.js';
import { screenApplicant } from './screening.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const config = loadConfig();
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');

const indeed = new IndeedService();
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService();
const slack = new SlackService(slackToken);

console.log('[Act] Processing pending human decisions...');

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, config);

const timeout = setTimeout(() => {
  console.error('Agent exceeded 30 minute timeout.');
  process.exit(1);
}, 30 * 60 * 1000);

try {
  await agent.processPendingDecisions();
  clearTimeout(timeout);
  console.log('\n[Act] Complete.');
} catch (err) {
  clearTimeout(timeout);
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await indeed.close();
}
