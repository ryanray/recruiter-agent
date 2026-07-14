// Weekly recruiting report: counts events from the Events tab for a date range,
// prints to console, and posts to the recruiting Slack channel.
// Usage: npm run weekly-report -- 7/6/2026 7/12/2026   (both dates inclusive)
import 'dotenv/config';
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import { loadConfig } from '../config.js';
import { SlackService } from '../adapters/slack.js';
import { parseReportDate, countEvents, formatWeeklyReport } from '../report.js';

const usage = 'Usage: npm run weekly-report -- <start M/D/YYYY> <end M/D/YYYY>  (both inclusive)';
const [startArg, endArg] = process.argv.slice(2);
if (!startArg || !endArg) {
  console.error(usage);
  process.exit(1);
}
const startDate = parseReportDate(startArg);
const endDate = parseReportDate(endArg);
if (!startDate || !endDate) {
  console.error(`Could not parse "${!startDate ? startArg : endArg}" as M/D/YYYY.\n${usage}`);
  process.exit(1);
}
if (startDate > endDate) {
  console.error(`Start date ${startArg} is after end date ${endArg}.\n${usage}`);
  process.exit(1);
}

const config = loadConfig();
const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

let rows: string[][];
try {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google_sheets.tracker_spreadsheet_id,
    range: 'Events!A2:D',
  });
  rows = (response.data.values ?? []) as string[][];
} catch (err) {
  console.error(`Could not read the Events tab (${err instanceof Error ? err.message : err}).`);
  console.error('If the tab does not exist yet, run: npm run add-events-tab');
  process.exit(1);
}

const report = formatWeeklyReport(countEvents(rows, startDate, endDate), startArg, endArg);
console.log(`\n${report}\n`);

const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) {
  console.error('SLACK_BOT_TOKEN not set in .env — report printed above but NOT posted to Slack.');
  process.exit(1);
}
try {
  await new SlackService(slackToken).post(config.slack.recruiting_channel, report);
  console.log('Report posted to Slack.');
} catch (err) {
  console.error(`Slack post failed — report printed above. ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
