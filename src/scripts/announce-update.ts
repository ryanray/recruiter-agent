import 'dotenv/config';
import { SlackService } from '../adapters/slack.js';
import { loadConfig } from '../config.js';

// Usage: npm run announce-update -- "Message describing what changed"
// The message supports Slack markdown (*bold*, _italic_, bullet points with •)

const message = process.argv.slice(2).join(' ').trim();
if (!message) {
  console.error('Usage: npm run announce-update -- "Your update message here"');
  process.exit(1);
}

const config = loadConfig();
const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');

const slack = new SlackService(slackToken);

await slack.post(
  config.slack.recruiting_channel,
  `📋 *Chandler Update*\n\n${message}`
);

console.log('Announcement posted to Slack.');
