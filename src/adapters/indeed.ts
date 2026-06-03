import { readFile } from 'fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { IndeedAdapter, Applicant, Interview } from '../types.js';

// Path to a persistent Chromium profile so Google OAuth sessions survive across runs.
// On the first run the browser opens and you log in manually; subsequent runs reuse the session.
const CHROME_PROFILE_DIR = new URL('../../data/chrome-profile', import.meta.url).pathname;

export class IndeedService implements IndeedAdapter {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private async getPage(): Promise<Page> {
    if (this.page) return this.page;
    // persistentContext keeps cookies/localStorage across runs — no manual re-login needed
    this.context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
      headless: false,
      args: ['--no-sandbox'],
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    await this.ensureLoggedIn();
    return this.page;
  }

  private async ensureLoggedIn(): Promise<void> {
    const page = this.page!;
    await page.goto('https://employers.indeed.com/candidates');
    // If redirected away (login page, Google OAuth, etc.), wait for the user to complete sign-in
    if (!page.url().includes('employers.indeed.com/candidates')) {
      console.log('Not logged in to Indeed. Please log in via the browser window that just opened.');
      console.log('You have 5 minutes to complete sign-in.');
      await page.waitForURL('**/employers.indeed.com/candidates**', { timeout: 300_000 });
      await page.waitForLoadState('domcontentloaded');
      console.log('Indeed login detected. Continuing...');
    }
  }

  async getNewApplications(_since: Date): Promise<Applicant[]> {
    const page = await this.getPage();
    await page.goto('https://employers.indeed.com/candidates');
    await page.waitForSelector('[data-testid="candidate-list-table-container"]', { timeout: 30_000 });

    const applicants: Applicant[] = [];
    const items = await page.$$('[data-testid="table-row"]');

    for (const item of items) {
      // Skip candidates already marked (shortlisted, undecided, or no interest)
      const alreadyMarked = await item.$('[data-testid^="ApplicantSentiment-"][data-is-selected="true"]') !== null;
      if (alreadyMarked) continue;

      const nameEl = await item.$('[data-testid="NameCell"]');
      const name = ((await nameEl?.textContent()) ?? '').trim();
      const href = (await nameEl?.getAttribute('href')) ?? '';
      const idMatch = href.match(/[?&]id=([a-z0-9]+)/);
      const id = idMatch?.[1] ?? '';
      if (!id || !name) continue;

      const profileUrl = `https://employers.indeed.com${href}`;
      const location = await item.$eval(
        '[data-testid="CandidateInfoColumn-location"]',
        el => el.textContent?.trim() ?? ''
      ).catch(() => '');

      const [firstName, ...rest] = name.split(' ');
      applicants.push({
        id, name,
        firstName: firstName ?? name,
        lastName: rest.join(' '),
        location,
        indeedProfileUrl: profileUrl,
      });
    }

    // Visit each candidate's detail page to extract profile text for screening
    for (const applicant of applicants) {
      try {
        applicant.resumeText = await this.fetchProfileText(applicant.indeedProfileUrl);
      } catch {
        // resumeText stays undefined — screening will handle missing data
      }
    }

    return applicants;
  }

  // Extracts text from the candidate detail page for Claude screening.
  // Uses screener answers + experience/skills/certs sections instead of resume PDF
  // so we have structured text without needing to parse a PDF.
  private async fetchProfileText(profileUrl: string): Promise<string> {
    const page = await this.getPage();
    await page.goto(profileUrl);
    await page.waitForSelector('[data-testid="load-complete"]', { timeout: 30_000 });

    const selectors = [
      '[data-testid="ScreenerAnswersRemoteModule"]',
      '[data-testid="profile-section-Experience"]',
      '[data-testid="profile-section-Skills"]',
      '[data-testid="profile-section-Certifications & licenses"]',
      '[data-testid="profile-section-Education"]',
    ];

    const texts: string[] = [];
    for (const sel of selectors) {
      try {
        const text = await page.$eval(sel, el => el.textContent?.trim() ?? '');
        if (text) texts.push(text);
      } catch {
        // section not present on this profile
      }
    }
    return texts.join('\n\n');
  }

  async sendMessage(applicantId: string, message: string): Promise<void> {
    const page = await this.getPage();
    await page.goto(`https://employers.indeed.com/candidates/${applicantId}/messages`);
    await page.waitForSelector('[data-testid="message-input"]');
    await page.fill('[data-testid="message-input"]', message);
    await page.click('[data-testid="send-message-button"]');
    await page.waitForSelector('[data-testid="message-sent-confirmation"]', { timeout: 10_000 });
  }

  async triggerScheduler(applicantId: string, hiringTeamEmails: string[]): Promise<void> {
    const page = await this.getPage();
    await page.goto(`https://employers.indeed.com/candidates/${applicantId}`);
    await page.waitForSelector('[data-testid="schedule-interview-button"]', { timeout: 30_000 });
    await page.click('[data-testid="schedule-interview-button"]');
    if (hiringTeamEmails.length > 0) {
      await page.waitForSelector('[data-testid="hiring-team-emails"]', { timeout: 30_000 });
      await page.fill('[data-testid="hiring-team-emails"]', hiringTeamEmails.join(', '));
    }
    await page.waitForSelector('[data-testid="scheduler-sent-confirmation"]', { timeout: 30_000 });
  }

  async getBookedInterviews(): Promise<Interview[]> {
    const page = await this.getPage();
    await page.goto('https://employers.indeed.com/interviews/upcoming');
    await page.waitForSelector('[data-testid="interview-list"]', { timeout: 30_000 });

    const items = await page.$$('[data-testid="interview-list-item"]');
    const interviews: Interview[] = [];

    for (const item of items) {
      const name = await item.$eval('[data-testid="candidate-name"]', el => el.textContent?.trim() ?? '');
      const id = await item.getAttribute('data-applicant-id') ?? '';
      const interviewId = await item.getAttribute('data-interview-id') ?? '';
      const timeText = await item.$eval('[data-testid="interview-time"]', el => el.textContent ?? '');
      interviews.push({
        applicantId: id,
        applicantName: name,
        scheduledAt: new Date(timeText),
        indeedInterviewId: interviewId,
      });
    }

    return interviews;
  }

  async downloadResume(applicantId: string): Promise<Buffer> {
    const page = await this.getPage();
    await page.goto(`https://employers.indeed.com/candidates/view?id=${applicantId}`);
    await page.waitForSelector('[data-testid="download-resume-inline"]', { timeout: 30_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-resume-inline"]'),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Resume download failed: no path');
    return readFile(path);
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }
}
