import 'dotenv/config';
import { google } from 'googleapis';
import http from 'http';
import { exec } from 'child_process';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  console.error('Get them from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3000');

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
  prompt: 'consent', // ensures a refresh token is always returned
});

console.log('Opening browser for Google authorization...');
console.log('If the browser does not open, visit this URL manually:\n');
console.log(authUrl + '\n');
exec(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost:3000');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authorization failed. You can close this tab.</h1>');
    server.close();
    console.error('Authorization failed:', error);
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Waiting for authorization...</h1>');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Authorization successful! You can close this tab.</h1>');
  server.close();

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('\nNo refresh token returned.');
    console.error('Go to https://myaccount.google.com/permissions, revoke access for this app, then re-run this script.');
    process.exit(1);
  }

  console.log('Authorization successful!\n');
  console.log('Add this line to your .env file:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nThen run the smoke tests to verify.');
});

server.listen(3000, () => {
  console.log('Waiting for authorization on http://localhost:3000 ...');
});
