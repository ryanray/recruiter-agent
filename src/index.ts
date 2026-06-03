import 'dotenv/config';
import { loadConfig } from './config.js';
import { readState, writeState } from './state.js';
import { screenApplicant } from './screening.js';
import { formatRunLog } from './logger.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const config = loadConfig();

const slackToken = process.env.SLACK_BOT_TOKEN;
const indeedEmail = process.env.INDEED_EMAIL;
const indeedPassword = process.env.INDEED_PASSWORD;

if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');
if (!indeedEmail) throw new Error('INDEED_EMAIL not set in .env');
if (!indeedPassword) throw new Error('INDEED_PASSWORD not set in .env');

const indeed = new IndeedService(indeedEmail, indeedPassword);
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService();
const slack = new SlackService(slackToken);

const state = readState();
const since = state?.lastRunAt ? new Date(state.lastRunAt) : new Date(0);

console.log(`Starting recruiter agent run. Checking applications since: ${since.toISOString()}`);

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, config);

const timeout = setTimeout(() => {
  console.error('Agent exceeded 30 minute timeout.');
  slack.post(config.slack.recruiting_channel, '⚠️ Recruiter agent timed out after 30 minutes. Manual check needed.')
    .finally(() => process.exit(1));
}, 30 * 60 * 1000);

try {
  const result = await agent.run(since);
  clearTimeout(timeout);

  const log = formatRunLog(result);
  console.log('\n' + log);

  writeState({ lastRunAt: result.startedAt.toISOString() });
  console.log(`\nRun complete. Processed ${result.newApplicantsReviewed} applicants.`);
} catch (err) {
  clearTimeout(timeout);
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal error:', message);
  await slack.post(config.slack.recruiting_channel, `🚨 Recruiter agent crashed: ${message}`).catch(() => {});
  process.exit(1);
} finally {
  await indeed.close();
}
