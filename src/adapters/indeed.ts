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
    // If redirected to a login page, wait for the user to log in manually
    if (!page.url().includes('employers.indeed.com/candidates')) {
      console.log('Not logged in to Indeed. Please log in via the browser window that just opened.');
      await page.waitForURL('**/employers.indeed.com/candidates**', { timeout: 120_000 });
      console.log('Indeed login detected. Continuing...');
    }
  }

  async getNewApplications(since: Date): Promise<Applicant[]> {
    const page = await this.getPage();
    await page.goto('https://employers.indeed.com/candidates');
    // TODO: Indeed's candidate list selectors — update if the page layout changes.
    // Selectors below are starting points; verify against the live page.
    await page.waitForSelector('[data-testid="applicant-list"]', { timeout: 15_000 });

    const applicants: Applicant[] = [];
    const items = await page.$$('[data-testid="applicant-list-item"]');

    for (const item of items) {
      // Skip candidates already marked as shortlisted, undecided, or no interest
      // TODO: verify selector — this targets any existing interest status badge
      const alreadyMarked = await item.$('[data-testid="interest-status"]') !== null;
      if (alreadyMarked) continue;

      const appliedText = await item.$eval('[data-testid="applied-date"]', el => el.textContent ?? '');
      const appliedAt = parseIndeedDate(appliedText);
      if (appliedAt <= since) continue;

      const name = await item.$eval('[data-testid="applicant-name"]', el => el.textContent?.trim() ?? '');
      const id = await item.getAttribute('data-applicant-id') ?? '';
      const profileUrl = await item.$eval('a', el => el.href);

      const [firstName, ...rest] = name.split(' ');
      applicants.push({
        id, name,
        firstName: firstName ?? name,
        lastName: rest.join(' '),
        indeedProfileUrl: profileUrl,
        appliedAt,
      });
    }

    // Fetch resume text for each applicant
    for (const applicant of applicants) {
      try {
        applicant.resumeText = await this.fetchResumeText(applicant.indeedProfileUrl);
      } catch {
        // resumeText stays undefined — screening will handle missing data
      }
    }

    return applicants;
  }

  private async fetchResumeText(profileUrl: string): Promise<string> {
    const page = await this.getPage();
    await page.goto(profileUrl);
    await page.waitForSelector('[data-testid="resume-section"]', { timeout: 10_000 });
    return page.$eval('[data-testid="resume-section"]', el => el.textContent ?? '');
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
    await page.waitForSelector('[data-testid="schedule-interview-button"]');
    await page.click('[data-testid="schedule-interview-button"]');
    // TODO: verify selector against live Indeed DOM
    if (hiringTeamEmails.length > 0) {
      await page.waitForSelector('[data-testid="hiring-team-emails"]', { timeout: 10_000 });
      await page.fill('[data-testid="hiring-team-emails"]', hiringTeamEmails.join(', '));
    }
    await page.waitForSelector('[data-testid="scheduler-sent-confirmation"]', { timeout: 15_000 });
  }

  async getBookedInterviews(): Promise<Interview[]> {
    const page = await this.getPage();
    await page.goto('https://employers.indeed.com/interviews/upcoming');
    await page.waitForSelector('[data-testid="interview-list"]', { timeout: 15_000 });

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
    await page.goto(`https://employers.indeed.com/candidates/${applicantId}`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-resume-button"]'),
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

function parseIndeedDate(text: string): Date {
  const trimmed = text.trim();
  if (trimmed.includes('ago')) {
    const dayMatch = trimmed.match(/(\d+)\s+day/);
    if (dayMatch) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(dayMatch[1], 10));
      return d;
    }
    const hourMatch = trimmed.match(/(\d+)\s+hour/);
    if (hourMatch) {
      const d = new Date();
      d.setHours(d.getHours() - parseInt(hourMatch[1], 10));
      return d;
    }
    // "X minutes ago", "just now", or any other "ago" string — treat as now
    return new Date();
  }
  return new Date(trimmed);
}
