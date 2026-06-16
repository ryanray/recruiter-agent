import { readFile } from 'fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { IndeedAdapter, Applicant, Interview } from '../types.js';

function jitter(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Path to a persistent Chromium profile so Google OAuth sessions survive across runs.
// On the first run the browser opens and you log in manually; subsequent runs reuse the session.
const CHROME_PROFILE_DIR = new URL('../../data/chrome-profile', import.meta.url).pathname;

export class IndeedService implements IndeedAdapter {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private jobIds: string[]) {}

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
    const seen = new Set<string>();
    const applicants: Applicant[] = [];

    for (const jobId of this.jobIds) {
      const url = `https://employers.indeed.com/candidates?statusName=All&tab=manage&id=${jobId}`;
      console.log(`[Indeed] Loading candidates for job ${jobId}...`);
      await page.goto(url);
      await page.waitForSelector('[data-testid="candidate-list-table-container"]', { timeout: 30_000 });
      await jitter(800, 1800);

      // Indeed's SPA persists pagination state across navigations — back-click to page 1 if needed
      await this.rewindToFirstPage(page);

      while (true) {
        const counter = await page.$eval(
          '[data-testid="pagination-candidate-counter"]',
          el => el.textContent?.trim() ?? ''
        ).catch(() => '');
        const items = await page.$$('[data-testid="table-row"]');
        console.log(`[Indeed] ${counter} — processing ${items.length} row(s).`);

        for (const item of items) {
          // Skip candidates already marked (shortlisted, undecided, or no interest)
          const alreadyMarked = await item.$('[data-testid^="ApplicantSentiment-"][data-is-selected="true"]') !== null;
          if (alreadyMarked) {
            const skippedName = ((await item.$eval('[data-testid="NameCell"]', el => el.textContent).catch(() => '')) ?? '').trim();
            console.log(`[Indeed] Skipping already-marked candidate: ${skippedName}`);
            continue;
          }

          const nameEl = await item.$('[data-testid="NameCell"]');
          const name = ((await nameEl?.textContent()) ?? '').trim();
          const href = (await nameEl?.getAttribute('href')) ?? '';
          const idMatch = href.match(/[?&]id=([a-z0-9]+)/);
          const id = idMatch?.[1] ?? '';
          if (!id || !name) {
            console.log('[Indeed] Skipping row — could not extract name or ID.');
            continue;
          }

          if (seen.has(id)) {
            console.log(`[Indeed] Skipping duplicate candidate: ${name} (id=${id})`);
            continue;
          }
          seen.add(id);

          const profileUrl = `https://employers.indeed.com${href}`;
          const location = await item.$eval(
            '[data-testid="CandidateInfoColumn-location"]',
            el => el.textContent?.trim() ?? ''
          ).catch(() => '');

          console.log(`[Indeed] Found candidate: ${name} (${location || 'no location'}) id=${id}`);
          const [firstName, ...rest] = name.split(' ');
          applicants.push({
            id, name,
            firstName: firstName ?? name,
            lastName: rest.join(' '),
            location,
            indeedProfileUrl: profileUrl,
          });
        }

        const navButtons = await page.$$('nav[aria-label="pagination"] button');
        const nextButton = navButtons[navButtons.length - 1];
        if (!nextButton || await nextButton.isDisabled()) break;

        console.log('[Indeed] Moving to next page of candidates...');
        await nextButton.click();
        await page.waitForSelector('[data-testid="candidate-list-table-container"]', { timeout: 30_000 });
        await jitter(800, 1800);
      }

      console.log(`[Indeed] Finished job ${jobId} — ${applicants.length} unique candidate(s) so far.`);
    }

    console.log(`[Indeed] ${applicants.length} total unprocessed candidate(s) to screen.`);
    return applicants;
  }

  async fetchProfileText(profileUrl: string): Promise<string> {
    return this.fetchProfileTextInternal(profileUrl);
  }

  private async fetchProfileTextInternal(profileUrl: string): Promise<string> {
    const page = await this.getPage();
    await jitter(500, 1200);
    await page.goto(profileUrl);
    await page.waitForSelector('[data-testid="load-complete"]', { state: 'attached', timeout: 30_000 });
    await jitter(600, 1400);

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

  async markSentiment(applicantId: string, sentiment: 'yes' | 'maybe' | 'no'): Promise<void> {
    const page = await this.getPage();
    console.log(`[Indeed] Marking sentiment "${sentiment}" for applicant ${applicantId}...`);
    await jitter(400, 900);
    await page.goto(`https://employers.indeed.com/candidates/view?id=${applicantId}`);
    await page.waitForSelector(`[data-testid="ApplicantSentiment-${sentiment}"]`, { timeout: 30_000 });
    await jitter(500, 1000);
    await page.click(`[data-testid="ApplicantSentiment-${sentiment}"]`);
    await jitter(300, 700);
    console.log(`[Indeed] Sentiment "${sentiment}" marked.`);
  }

  async setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void> {
    const page = await this.getPage();
    console.log(`[Indeed] Setting up interview for applicant ${applicantId}...`);

    await jitter(500, 1200);
    await page.goto(`https://employers.indeed.com/candidates/view?id=${applicantId}`);
    await page.waitForSelector('[data-testid="prioritized-schedule-interview-button"]', { timeout: 30_000 });
    await jitter(600, 1200);

    console.log('[Indeed] Clicking Setup Interview button...');
    await page.click('[data-testid="prioritized-schedule-interview-button"]');
    await page.waitForSelector('[data-testid="ScheduleInterviewModal-SendInterviewButton"]', { timeout: 30_000 });
    await jitter(600, 1200);

    console.log('[Indeed] Setting duration...');
    await page.click('[data-testid="InterviewTimesSelector-duration"]');
    await jitter(300, 600);
    await page.click('[data-testid="InterviewTimesSelector-duration-15"]');
    await jitter(400, 800);

    console.log('[Indeed] Setting format to phone...');
    await page.getByRole('radio', { name: 'Phone' }).click({ force: true });
    await jitter(400, 800);

    console.log('[Indeed] Filling message...');
    await page.click('[data-testid="gt-interview-form-message-to-candidate-text-area"]');
    await jitter(300, 700);
    await page.fill('[data-testid="gt-interview-form-message-to-candidate-text-area"]', '');
    await page.type('[data-testid="gt-interview-form-message-to-candidate-text-area"]', options.message, { delay: 10 + Math.random() * 15, timeout: 120_000 });
    await jitter(400, 900);

    const switchChecked = await page.$eval(
      '[data-testid="gt-interview-details-hiring-team-switch"]',
      el => el.getAttribute('aria-checked') === 'true' || (el as HTMLInputElement).checked
    );
    if (!switchChecked) {
      console.log('[Indeed] Enabling hiring team switch...');
      await page.click('[data-testid="gt-interview-details-hiring-team-switch"]');
      await jitter(400, 800);
    } else {
      console.log('[Indeed] Hiring team switch already enabled, skipping.');
    }

    if (options.hiringTeamEmails.length > 0) {
      console.log('[Indeed] Filling hiring team emails...');
      await page.click('[data-testid="gt-interview-details-interviewer-list"]');
      await jitter(300, 600);
      await page.type('[data-testid="gt-interview-details-interviewer-list"]', options.hiringTeamEmails.join(', '), { delay: 40 + Math.random() * 60 });
      await jitter(400, 800);
    }

    console.log('[Indeed] Selecting availability-based scheduling...');
    await page.click('[data-value="availabilityBasedScheduling"]');
    await jitter(400, 800);

    console.log('[Indeed] Sending interview request...');
    await page.click('[data-testid="ScheduleInterviewModal-SendInterviewButton"]');
    await page.waitForSelector('[data-testid="ScheduleInterviewModal-SendInterviewButton"]', { state: 'detached', timeout: 30_000 });
    console.log('[Indeed] Interview request sent successfully.');
  }

  async getBookedInterviews(): Promise<Interview[]> {
    const page = await this.getPage();
    console.log('[Indeed] Fetching booked interviews...');
    await jitter(500, 1000);
    await page.goto('https://employers.indeed.com/interviews/upcoming');
    await page.waitForSelector('[data-testid="interviewList"]', { timeout: 30_000 });
    await jitter(600, 1200);

    const accountFilterText = await page.$eval(
      '[aria-label="Account filter"]',
      el => el.textContent?.trim() ?? ''
    );
    if (!accountFilterText.includes('Your account')) {
      console.log('[Indeed] Filtering to "Your account"...');
      await page.click('[aria-label="Account filter"]');
      await jitter(300, 600);
      await page.getByRole('option', { name: 'Your account' }).click();
      await page.waitForSelector('[data-testid="interviewList"]', { timeout: 15_000 });
      await jitter(600, 1200);
    } else {
      console.log('[Indeed] Account filter already set to "Your account".');
    }

    const interviews: Interview[] = [];

    while (true) {
      const cards = await page.$$('[data-testid="InterviewCard-Wrapper"]');
      console.log(`[Indeed] Processing ${cards.length} interview card(s) on this page...`);

      for (const card of cards) {
        await card.$eval('[data-testid="interview-card-candidate"]', el => (el as HTMLElement).click());
        await page.waitForSelector('[data-testid="CandidateDetails-viewCandidateLink"]', { timeout: 15_000 });
        await jitter(400, 800);

        const href = await page.$eval(
          '[data-testid="CandidateDetails-viewCandidateLink"]',
          el => el.getAttribute('href') ?? ''
        );
        const applicantId = href.match(/[?&]id=([a-z0-9-]+)/)?.[1] ?? '';

        const applicantName = await card.$eval(
          '[data-testid="interview-card-candidate"]',
          el => el.textContent?.trim() ?? ''
        );

        const scheduledAt = await page.$eval(
          '[data-testid="interviewDetails-datetime"]',
          el => el.textContent?.trim() ?? ''
        );

        if (applicantId) {
          interviews.push({ applicantId, applicantName, scheduledAt });
          console.log(`[Indeed] Interview found: ${applicantName} (${applicantId}) — ${scheduledAt}`);
        } else {
          console.log(`[Indeed] Could not extract applicantId from href "${href}" — skipping card.`);
        }

        await jitter(300, 700);
      }

      const paginationButtons = await page.$$('[data-testid="interviewList-ListPagination"] button');
      const nextButton = paginationButtons[1];
      if (!nextButton || await nextButton.isDisabled()) break;

      console.log('[Indeed] Moving to next page of interviews...');
      await nextButton.click();
      await page.waitForSelector('[data-testid="interviewList"]', { timeout: 15_000 });
      await jitter(600, 1200);
    }

    console.log(`[Indeed] ${interviews.length} booked interview(s) found total.`);
    return interviews;
  }

  async downloadResume(applicantId: string): Promise<Buffer> {
    const page = await this.getPage();
    console.log(`[Indeed] Downloading resume for applicant ${applicantId}...`);
    await jitter(500, 1200);
    await page.goto(`https://employers.indeed.com/candidates/view?id=${applicantId}`);
    await page.waitForSelector('[data-testid="download-resume-inline"]', { timeout: 30_000 });
    await jitter(600, 1200);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-resume-inline"]'),
    ]);
    const path = await download.path();
    if (!path) throw new Error('Resume download failed: no path');
    const buf = await readFile(path);
    console.log(`[Indeed] Resume downloaded (${buf.length} bytes).`);
    return buf;
  }

  private async rewindToFirstPage(page: Page): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const counter = await page.$eval(
        '[data-testid="pagination-candidate-counter"]',
        el => el.textContent?.trim() ?? ''
      ).catch(() => '');

      // Counter is empty (≤1 page) or starts with "Showing 1-" meaning we're on page 1
      if (!counter || /^Showing 1[^0-9]/i.test(counter)) break;

      console.log(`[Indeed] Not on page 1 (${counter}) — clicking Previous...`);
      const navButtons = await page.$$('nav[aria-label="pagination"] button');
      const prevButton = navButtons[0];
      if (!prevButton || await prevButton.isDisabled()) break;
      await prevButton.click();
      await page.waitForSelector('[data-testid="candidate-list-table-container"]', { timeout: 15_000 });
      await jitter(400, 800);
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }
}
