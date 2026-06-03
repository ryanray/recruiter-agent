import { google } from 'googleapis';

export function getGoogleAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env\n' +
      'Run: npx tsx smoke/google-oauth-setup.ts'
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3000');
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}
