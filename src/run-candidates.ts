import 'dotenv/config';
import { loadConfig } from './config.js';
import { readState, writeState, markProcessed } from './state.js';
import { screenApplicant } from './screening.js';
import { scoreApplicant } from './scorer.js';
import { formatRunLog, formatCandidateSummary, startFileLog } from './logger.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const stopLog = startFileLog('candidates');
const config = loadConfig();
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');

const indeed = new IndeedService(config.indeed.job_ids);
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService();
const slack = new SlackService(slackToken);

const state = readState();
const since = state?.lastRunAt ? new Date(state.lastRunAt) : new Date(0);
const processedIds = new Set(state?.processedIds ?? []);

console.log(`[Evaluate] Checking applications since: ${since.toISOString()}`);

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, scoreApplicant, config);

const timeout = setTimeout(() => {
  console.error(`Agent exceeded ${config.run.timeout_minutes} minute timeout.`);
  process.exit(1);
}, config.run.timeout_minutes * 60 * 1000);

try {
  const result = await agent.evaluateCandidates(since, processedIds, (id) => markProcessed(id));
  clearTimeout(timeout);
  console.log('\n' + formatRunLog(result));
  writeState({ lastRunAt: result.startedAt.toISOString(), processedIds: [...processedIds] });
  console.log(`\nEvaluate complete. Processed ${result.newApplicantsReviewed} applicants.`);
  await slack.post(config.slack.recruiting_channel, formatCandidateSummary(result));
} catch (err) {
  clearTimeout(timeout);
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  throw err;
} finally {
  await indeed.close();
  stopLog();
}
