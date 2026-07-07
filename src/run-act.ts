import 'dotenv/config';
import { loadConfig } from './config.js';
import { startFileLog, formatActSummary } from './logger.js';
import { screenApplicant } from './screening.js';
import { scoreApplicant } from './scorer.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const stopLog = startFileLog('act');
const config = loadConfig();
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');

const indeed = new IndeedService(config.indeed.job_ids);
const sheets = new SheetsService(config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService();
const slack = new SlackService(slackToken);

console.log('[Act] Processing pending human decisions...');

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, scoreApplicant, config);

const timeout = setTimeout(() => {
  console.error(`Agent exceeded ${config.run.timeout_minutes} minute timeout.`);
  process.exit(1);
}, config.run.timeout_minutes * 60 * 1000);

try {
  const { actioned } = await agent.processPendingDecisions();
  const { newlyBooked } = await agent.processBookedInterviews();
  const { followUpsSent, neverResponded, humanReviewFlagged } = await agent.processFollowUps();
  clearTimeout(timeout);
  console.log(`[Act] Follow-ups sent: ${followUpsSent.length}`);
  if (followUpsSent.length > 0) {
    for (const f of followUpsSent) console.log(`  → ${f.name} — invite #${f.inviteCount}`);
  }
  if (neverResponded.length > 0) {
    console.log(`[Act] Moved to Never Responded: ${neverResponded.join(', ')}`);
  }
  if (humanReviewFlagged.length > 0) {
    console.log(`[Act] Flagged for human review: ${humanReviewFlagged.join(', ')}`);
  }
  console.log('\n[Act] Complete.');
  await slack.post(config.slack.recruiting_channel, formatActSummary({ actioned, newlyBooked, followUpsSent, neverResponded, humanReviewFlagged }));
} catch (err) {
  clearTimeout(timeout);
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  throw err;
} finally {
  await indeed.close();
  stopLog();
}
