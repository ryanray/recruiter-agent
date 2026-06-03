import { SlackService } from '../src/adapters/slack.js';
import 'dotenv/config';

const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error('SLACK_BOT_TOKEN not set in .env');

const slack = new SlackService(token);

console.log('Posting test message to #recruiting-test...');
await slack.post('#recruiting-private', '🤖 Recruiter agent smoke test — Slack adapter working.');
console.log('Done.');
