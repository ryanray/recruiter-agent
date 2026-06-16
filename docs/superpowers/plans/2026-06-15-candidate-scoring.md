# Candidate Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rubric-based scoring (0–100) to each candidate using their resume PDF, Indeed profile, and a structured LLM prompt, and write the results to 6 new spreadsheet columns.

**Architecture:** A new `Scorer` injectable (parallel to the existing `Screener`) is injected into `Agent`. `scoreApplicant` in `src/scorer.ts` assembles the scoring prompt from static markdown files and the candidate's combined profile + PDF text, calls Claude, and returns a parsed `ScoreResult`. PDF text is extracted by a standalone `extractPdfText` in `src/pdf.ts` using `pdf-parse`. Scoring runs after screening so the existing PASS/FAIL/UNSURE gate is unchanged.

**Tech Stack:** TypeScript (ESM), Vitest, Anthropic SDK, `pdf-parse`, Google Sheets API (googleapis)

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `ScoreResult`, `Scorer` type; extend `CandidateRow` with 6 score fields; add `pdfFailures`/`scoreFailures` to `RunResult` |
| `src/scoring-prompt.md` | Add JSON output instruction at the end |
| `src/pdf.ts` | **Create** — `extractPdfText(buffer: Buffer): Promise<string>` |
| `src/scorer.ts` | **Create** — `parseScoreResponse(text: string): ScoreResult` + `scoreApplicant(applicant, config): Promise<ScoreResult>` |
| `src/adapters/sheets.ts` | Extend `COLUMNS` with 6 new fields; update all range strings from `A:N` → `A:T` |
| `src/agent.ts` | Add `scorer` to constructor; call `extractPdfText` + `scoreApplicant` in `evaluateCandidates`; merge score onto row; track failures |
| `src/logger.ts` | Extend `formatRunLog` to show PDF failure and score failure counts |
| `src/index.ts` | Import and pass `scoreApplicant` to `Agent` constructor |
| `src/run-candidates.ts` | Same as `index.ts` |
| `tests/pdf.test.ts` | **Create** — unit tests for `extractPdfText` |
| `tests/scorer.test.ts` | **Create** — unit tests for `parseScoreResponse` |
| `tests/pipeline.test.ts` | Update `makeCandidate` for new fields; pass a fake scorer to `new Agent(...)` |

---

## Task 1: Install pdf-parse

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the library and types**

```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

Expected: no errors. `package.json` now lists `pdf-parse` in `dependencies` and `@types/pdf-parse` in `devDependencies`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install pdf-parse for resume text extraction"
```

---

## Task 2: Update types.ts

Add `ScoreResult`, extend `CandidateRow`, add `Scorer` type, and add failure tracking to `RunResult`.

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `ScoreResult`, extend `CandidateRow` and `RunResult`, add `Scorer` type**

Open `src/types.ts`. Make the following changes:

After the `ScreeningResult` interface, add:

```ts
export interface ScoreResult {
  score: number;
  recommendation: 'Strong Interview' | 'Interview' | 'Maybe' | 'Pass';
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
  keyStrengths: string;
  concerns: string;
  interviewQuestions: string;
}
```

In `CandidateRow`, add these 6 optional fields after `notes`:

```ts
  score?: string;
  scoreRecommendation?: string;
  scoreTier?: string;
  keyStrengths?: string;
  scoreConcerns?: string;
  interviewQuestions?: string;
```

In `RunResult`, add these two fields after `errors`:

```ts
  pdfFailures: string[];
  scoreFailures: string[];
```

After the `Screener` type, add:

```ts
export type Scorer = (applicant: Applicant, config: Config) => Promise<ScoreResult>;
```

- [ ] **Step 2: Run tests to confirm nothing is broken**

```bash
npm test
```

Expected: all existing tests pass (the new optional fields don't break anything).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add ScoreResult, Scorer, extend CandidateRow and RunResult"
```

---

## Task 3: Update scoring-prompt.md

Add a JSON output instruction so `parseScoreResponse` can reliably parse the LLM's reply.

**Files:**
- Modify: `src/scoring-prompt.md`

- [ ] **Step 1: Replace the file content**

The full updated `src/scoring-prompt.md`:

```markdown
You are helping FirstLight Home Care of South Jordan screen caregiver resumes.

Use the caregiver resume screening guide and scoring rubric below to evaluate the candidate.

Important rules:
- Score only based on evidence in the resume.
- Do not assume skills that are not stated.
- Do not penalize too harshly for missing information if it can be validated in an interview.
- Separate confirmed strengths from items that need follow-up.
- Do not make hiring decisions based on protected characteristics.
- Focus on caregiving relevance, reliability, transportation, professionalism, and home care fit.

[PASTE SCREENING GUIDE]

[PASTE SCORING RUBRIC]

Candidate Resume:
[PASTE RESUME HERE]

Candidate Profile:
[PASTE CANDIDATE PROFILE HERE]

Return your evaluation as a valid JSON object with no markdown formatting:
{
  "score": <number 0-100>,
  "recommendation": <"Strong Interview" | "Interview" | "Maybe" | "Pass">,
  "tier": <"Tier 1" | "Tier 2" | "Tier 3" | "Tier 4">,
  "keyStrengths": "<concise bullet-point summary as a single string>",
  "concerns": "<concise bullet-point summary as a single string>",
  "interviewQuestions": "<semicolon-separated list of interview questions>"
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scoring-prompt.md
git commit -m "feat(scoring): add JSON output instruction to scoring prompt"
```

---

## Task 4: Create src/pdf.ts

**Files:**
- Create: `src/pdf.ts`
- Create: `tests/pdf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/pdf.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

import pdfParse from 'pdf-parse';
import { extractPdfText } from '../src/pdf.js';

describe('extractPdfText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns extracted text when pdf-parse succeeds', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: 'CNA certified, 3 years home care' } as any);
    const result = await extractPdfText(Buffer.from('fake-pdf'));
    expect(result).toBe('CNA certified, 3 years home care');
  });

  it('returns empty string when pdf-parse throws', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('invalid pdf'));
    const result = await extractPdfText(Buffer.from('garbage'));
    expect(result).toBe('');
  });

  it('returns empty string when pdf-parse returns empty text', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: '' } as any);
    const result = await extractPdfText(Buffer.from('fake-pdf'));
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test tests/pdf.test.ts
```

Expected: FAIL — `extractPdfText` is not defined.

- [ ] **Step 3: Implement src/pdf.ts**

Create `src/pdf.ts`:

```ts
import pdfParse from 'pdf-parse';

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    return result.text?.trim() ?? '';
  } catch (err) {
    console.error(`[PDF] Failed to extract text: ${err instanceof Error ? err.message : err}`);
    return '';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/pdf.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Run all tests to check for regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pdf.ts tests/pdf.test.ts
git commit -m "feat: add extractPdfText utility using pdf-parse"
```

---

## Task 5: Create src/scorer.ts

**Files:**
- Create: `src/scorer.ts`
- Create: `tests/scorer.test.ts`

The scorer reads three static markdown files at module load time. `parseScoreResponse` is a pure function that parses the LLM JSON output — it's the only testable part since the LLM call itself uses real I/O.

- [ ] **Step 1: Write failing tests for parseScoreResponse**

Create `tests/scorer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseScoreResponse } from '../src/scorer.js';

describe('parseScoreResponse', () => {
  it('parses a valid JSON response', () => {
    const json = JSON.stringify({
      score: 72,
      recommendation: 'Interview',
      tier: 'Tier 2',
      keyStrengths: 'CNA certified; 3 years home care',
      concerns: 'No dementia experience mentioned',
      interviewQuestions: 'Tell me about your CNA experience; Do you have reliable transportation?',
    });
    const result = parseScoreResponse(json);
    expect(result.score).toBe(72);
    expect(result.recommendation).toBe('Interview');
    expect(result.tier).toBe('Tier 2');
    expect(result.keyStrengths).toBe('CNA certified; 3 years home care');
    expect(result.concerns).toBe('No dementia experience mentioned');
    expect(result.interviewQuestions).toBe('Tell me about your CNA experience; Do you have reliable transportation?');
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const json = '```json\n{"score":55,"recommendation":"Maybe","tier":"Tier 3","keyStrengths":"Family caregiving","concerns":"No formal training","interviewQuestions":"What motivated you?"}\n```';
    const result = parseScoreResponse(json);
    expect(result.score).toBe(55);
    expect(result.recommendation).toBe('Maybe');
  });

  it('returns zero-score fallback on invalid JSON', () => {
    const result = parseScoreResponse('not json at all');
    expect(result.score).toBe(0);
    expect(result.recommendation).toBe('Pass');
    expect(result.tier).toBe('Tier 4');
    expect(result.keyStrengths).toBe('');
    expect(result.concerns).toBe('');
    expect(result.interviewQuestions).toBe('');
  });

  it('returns zero-score fallback on empty string', () => {
    const result = parseScoreResponse('');
    expect(result.score).toBe(0);
    expect(result.recommendation).toBe('Pass');
  });

  it('clamps score to 0 if missing', () => {
    const result = parseScoreResponse(JSON.stringify({ recommendation: 'Interview', tier: 'Tier 2', keyStrengths: '', concerns: '', interviewQuestions: '' }));
    expect(result.score).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test tests/scorer.test.ts
```

Expected: FAIL — `parseScoreResponse` is not defined.

- [ ] **Step 3: Implement src/scorer.ts**

Create `src/scorer.ts`:

```ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { Applicant, Config, ScoreResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const scoringPromptTemplate = readFileSync(join(__dirname, 'scoring-prompt.md'), 'utf8');
const screeningGuide = readFileSync(join(__dirname, 'scoring-screening-guide.md'), 'utf8');
const scoringRubric = readFileSync(join(__dirname, 'scoring-structure.md'), 'utf8');

const client = new Anthropic();

export function parseScoreResponse(text: string): ScoreResult {
  const fallback: ScoreResult = {
    score: 0,
    recommendation: 'Pass',
    tier: 'Tier 4',
    keyStrengths: '',
    concerns: '',
    interviewQuestions: '',
  };

  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<ScoreResult>;
    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      recommendation: parsed.recommendation ?? 'Pass',
      tier: parsed.tier ?? 'Tier 4',
      keyStrengths: parsed.keyStrengths ?? '',
      concerns: parsed.concerns ?? '',
      interviewQuestions: parsed.interviewQuestions ?? '',
    };
  } catch {
    return fallback;
  }
}

export async function scoreApplicant(applicant: Applicant, _config: Config): Promise<ScoreResult> {
  const prompt = scoringPromptTemplate
    .replace('[PASTE SCREENING GUIDE]', screeningGuide)
    .replace('[PASTE SCORING RUBRIC]', scoringRubric)
    .replace('[PASTE RESUME HERE]', applicant.resumeText ?? 'Not provided')
    .replace('[PASTE CANDIDATE PROFILE HERE]', `Name: ${applicant.name}\nLocation: ${applicant.location ?? 'not provided'}`);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return parseScoreResponse(text);
  } catch (err) {
    console.error(`[Scorer] Failed to score ${applicant.name}: ${err instanceof Error ? err.message : err}`);
    return parseScoreResponse('');
  }
}
```

- [ ] **Step 4: Run scorer tests**

```bash
npm test tests/scorer.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scorer.ts tests/scorer.test.ts
git commit -m "feat: add scorer module with scoreApplicant and parseScoreResponse"
```

---

## Task 6: Update src/adapters/sheets.ts

Extend `COLUMNS` from 14 to 20 fields and update all range strings.

**Files:**
- Modify: `src/adapters/sheets.ts`

- [ ] **Step 1: Extend COLUMNS and update all range strings**

Replace the `COLUMNS` constant and all range string occurrences. The final file:

```ts
import { google } from 'googleapis';
import { getGoogleAuth } from '../google-auth.js';
import type { SheetsAdapter, CandidateRow, CandidateStatus, PreviouslyContactedEntry } from '../types.js';

const COLUMNS = [
  'name','phone','email','indeedUrl','indeedId','location',
  'experience','certifications','agentRecommendation','status',
  'lastContact','driveFolder','humanDecision','notes',
  'score','scoreRecommendation','scoreTier','keyStrengths','scoreConcerns','interviewQuestions',
] as const;

type ColName = typeof COLUMNS[number];

export class SheetsService implements SheetsAdapter {
  private spreadsheetId: string;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
  }

  async addCandidate(tab: string, candidate: CandidateRow): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const values = [COLUMNS.map(col => (candidate as Record<string, unknown>)[col] ?? '')];
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${tab}!A:T`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A:T',
    });
    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex((r, i) => i > 0 && r[0]?.trim() === name.trim());
    if (rowIndex === -1) return;

    const row = [...(rows[rowIndex] as string[])];
    row[COLUMNS.indexOf('status')] = status;
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        const colIdx = COLUMNS.indexOf(key as ColName);
        if (colIdx !== -1) row[colIdx] = String(value ?? '');
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Active!A${rowIndex + 1}:T${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:T',
    });
    const rows = response.data.values ?? [];
    return rows.map(row => {
      const candidate: Record<string, string> = {};
      COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
      return candidate as unknown as CandidateRow;
    });
  }

  async getEvaluatedCandidateIds(): Promise<Set<string>> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const ids = new Set<string>();
    const indeedIdCol = COLUMNS.indexOf('indeedId');

    for (const tab of ['Active', 'Rejected', 'Checkback Later']) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A2:T`,
      });
      for (const row of response.data.values ?? []) {
        const id = (row[indeedIdCol] as string | undefined)?.trim();
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  async getCandidatesForAction(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:T',
    });
    const rows = response.data.values ?? [];
    const humanDecisionCol = COLUMNS.indexOf('humanDecision');
    return rows
      .filter(row => !!((row[humanDecisionCol] as string) ?? '').trim())
      .map(row => {
        const candidate: Record<string, string> = {};
        COLUMNS.forEach((col, i) => { candidate[col] = (row[i] as string) ?? ''; });
        return candidate as unknown as CandidateRow;
      });
  }

  async moveCandidate(name: string, fromTab: string, toTab: string): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${fromTab}!A:T`,
    });
    const rows = readRes.data.values ?? [];
    const rowIndex = rows.findIndex((r, i) => i > 0 && (r[0] as string)?.trim() === name.trim());
    if (rowIndex === -1) return;

    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${toTab}!A:T`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rows[rowIndex]] },
    });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const sheetId = meta.data.sheets
      ?.find(s => s.properties?.title === fromTab)
      ?.properties?.sheetId;
    if (sheetId == null) return;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
          },
        }],
      },
    });
  }

  async getPreviouslyContactedNames(lookbackDays?: number): Promise<{ name: string; lastContact: string }[]> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    if (lookbackDays !== undefined) {
      console.log(`[Sheets] Getting previously contacted names (lookback: ${lookbackDays} days)...`);
    } else {
      console.log('[Sheets] Getting all previously contacted names...');
    }
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Previously Contacted!A2:D',
    });
    const rows = response.data.values ?? [];
    const cutoff = lookbackDays !== undefined
      ? new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10)
      : undefined;
    const result = rows
      .map(row => ({
        name: ((row[0] as string) ?? '').trim(),
        lastContact: ((row[1] as string) ?? '').trim(),
      }))
      .filter(e => e.name && /^\d{4}-\d{2}-\d{2}$/.test(e.lastContact))
      .filter(e => cutoff === undefined || e.lastContact >= cutoff);
    console.log(`[Sheets] ${result.length} previously contacted entries returned.`);
    return result;
  }

  async addToPreviouslyContacted(entry: PreviouslyContactedEntry): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
    console.log(`[Sheets] Adding ${entry.name} to Previously Contacted tab...`);
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Previously Contacted!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[entry.name, entry.lastContact, entry.notes, entry.indeedId]] },
    });
  }
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass (the fake adapter is unaffected by real adapter range changes).

- [ ] **Step 3: Commit**

```bash
git add src/adapters/sheets.ts
git commit -m "feat(sheets): extend COLUMNS with 6 score fields, update ranges to A:T"
```

---

## Task 7: Update src/agent.ts and tests/pipeline.test.ts

Add `scorer` to the constructor, call `extractPdfText` + `scoreApplicant` per candidate, track PDF/score failures, and write score fields onto the sheet row.

**Files:**
- Modify: `src/agent.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Write a failing test that verifies score fields appear on the Active row**

Add this test inside the `'Agent.run — Phase 1'` describe block in `tests/pipeline.test.ts`, after the existing tests. First update the imports at the top of the file:

```ts
import type { Applicant, Config, ScreeningResult, CandidateRow, ScoreResult } from '../src/types.js';
```

Add a helper function for a default score result (place near the other helpers):

```ts
function defaultScore(): ScoreResult {
  return {
    score: 75,
    recommendation: 'Interview',
    tier: 'Tier 2',
    keyStrengths: 'Home care experience',
    concerns: 'No dementia experience mentioned',
    interviewQuestions: 'Tell me about your experience',
  };
}
```

Update every `new Agent(indeed, sheets, drive, slack, screener, config)` call to include a scorer argument — the scorer is the 6th parameter and config becomes the 7th. The pattern to follow:

```ts
// Before:
new Agent(indeed, sheets, drive, slack, async () => passResult(), config)

// After:
new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config)
```

Apply this update to all `new Agent(...)` calls in the file (there are approximately 18 occurrences; apply the same pattern to every one).

Then add this new test:

```ts
it('writes score fields to the Active sheet row', async () => {
  indeed.seedApplicants([makeApplicant()]);
  const scorer = async (): Promise<ScoreResult> => ({
    score: 82,
    recommendation: 'Strong Interview',
    tier: 'Tier 1',
    keyStrengths: 'CNA with dementia experience',
    concerns: '',
    interviewQuestions: 'Describe a difficult client situation',
  });
  const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), scorer, config);

  await agent.evaluateCandidates(since, new Set(), () => {});

  const row = sheets.tabs['Active'][0];
  expect(row.score).toBe('82');
  expect(row.scoreRecommendation).toBe('Strong Interview');
  expect(row.scoreTier).toBe('Tier 1');
  expect(row.keyStrengths).toBe('CNA with dementia experience');
  expect(row.scoreConcerns).toBe('');
  expect(row.interviewQuestions).toBe('Describe a difficult client situation');
});

it('adds [PDF text extraction failed] to notes when PDF extraction returns empty', async () => {
  indeed.seedApplicants([makeApplicant()]);
  const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), async () => defaultScore(), config);
  // FakeIndeedAdapter.downloadResume returns a non-PDF buffer — extractPdfText will fail on it
  // We rely on the agent's fallback behaviour: notes gets the warning appended
  // Override downloadResume to return empty-ish buffer to force empty pdf text:
  indeed.downloadResume = async () => Buffer.from('');

  await agent.evaluateCandidates(since, new Set(), () => {});

  // notes field should contain the PDF failure notice
  expect(sheets.tabs['Active'][0].notes).toContain('[PDF text extraction failed]');
});
```

- [ ] **Step 2: Run tests to confirm the new tests fail**

```bash
npm test tests/pipeline.test.ts
```

Expected: new tests fail; existing tests also fail (Agent constructor signature mismatch).

- [ ] **Step 3: Update src/agent.ts**

Replace the full content of `src/agent.ts`:

```ts
import type {
  IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
  Screener, Scorer, Config, RunResult, CandidateRow, CandidateStatus,
} from './types.js';
import { extractPdfText } from './pdf.js';
import { renderTemplate } from './messages.js';
import { getGitCommitHash } from './logger.js';

export class Agent {
  constructor(
    private indeed: IndeedAdapter,
    private sheets: SheetsAdapter,
    private drive: DriveAdapter,
    private slack: SlackAdapter,
    private screener: Screener,
    private scorer: Scorer,
    private config: Config,
  ) {}

  async evaluateCandidates(
    since: Date,
    processedIds: Set<string> = new Set(),
    markProcessed: (id: string) => void = () => {},
  ): Promise<RunResult> {
    const startedAt = new Date();
    const result: RunResult = {
      startedAt, completedAt: startedAt, durationMs: 0,
      newApplicantsReviewed: 0, remainingApplicants: 0,
      passed: [], rejected: [], unsure: [],
      bookings: [], coldCandidates: [], errors: [],
      pdfFailures: [], scoreFailures: [],
      configVersion: getGitCommitHash(),
      screeningCriteria: {
        required: this.config.screening.required,
        preferred: this.config.screening.preferred,
      },
    };

    const evaluatedIds = await this.sheets.getEvaluatedCandidateIds();

    let applicants = (await this.indeed.getNewApplications(since))
      .filter(a => !processedIds.has(a.id) && !evaluatedIds.has(a.id));

    const limit = this.config.run.max_candidates_per_run;
    result.remainingApplicants = limit ? Math.max(0, applicants.length - limit) : 0;
    if (limit) applicants = applicants.slice(0, limit);
    result.newApplicantsReviewed = applicants.length;

    console.log(`[Agent] Loading previously contacted candidates (lookback: ${this.config.scheduling.previously_contacted_lookback_days} days)...`);
    const previouslyContactedEntries = await this.sheets.getPreviouslyContactedNames(
      this.config.scheduling.previously_contacted_lookback_days
    );
    const priorContactMap = new Map(
      previouslyContactedEntries.map(e => [e.name.toLowerCase(), e.lastContact])
    );
    console.log(`[Agent] ${priorContactMap.size} previously contacted candidate(s) in window.`);

    for (const applicant of applicants) {
      console.log(`\n[Agent] Processing: ${applicant.name} (${applicant.location ?? 'no location'})`);
      try {
        console.log(`[Agent] Fetching profile text for ${applicant.name}...`);
        try {
          applicant.resumeText = await this.indeed.fetchProfileText(applicant.indeedProfileUrl);
          console.log(`[Agent] Profile text fetched (${applicant.resumeText.length} chars).`);
        } catch (profileErr) {
          console.log(`[Agent] Could not fetch profile text: ${profileErr instanceof Error ? profileErr.message : profileErr}`);
        }

        const priorContact = priorContactMap.get(applicant.name.toLowerCase());
        if (priorContact) {
          console.log(`[Agent] ${applicant.name} was previously contacted on ${priorContact} — flagging for human review.`);
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `⚠️ *Previously contacted:* ${applicant.name} — last seen ${priorContact}\nReview before acting: ${applicant.indeedProfileUrl}`
          );
        }

        console.log(`[Agent] Screening ${applicant.name} with Claude...`);
        const screening = await this.screener(applicant, this.config);
        console.log(`[Agent] Decision: ${screening.decision}${screening.reasons.length ? ' — ' + screening.reasons.join('; ') : ''}`);

        const nameLabel = `${applicant.lastName}, ${applicant.firstName}`;
        const folderName = `${nameLabel} - ${today()}`;

        console.log(`[Agent] Creating Drive folder: "${folderName}"`);
        const folderId = await this.drive.createFolder(
          folderName,
          this.config.google_drive.awaiting_action_folder_id
        );

        console.log(`[Agent] Downloading and uploading resume...`);
        const resume = await this.indeed.downloadResume(applicant.id);
        await this.drive.uploadFile(folderId, 'resume.pdf', resume, 'application/pdf');

        console.log(`[Agent] Extracting PDF text for ${applicant.name}...`);
        const pdfText = await extractPdfText(resume);
        let pdfNote = '';
        if (!pdfText) {
          console.log(`[Agent] PDF text extraction failed for ${applicant.name}.`);
          result.pdfFailures.push(applicant.name);
          pdfNote = '[PDF text extraction failed] ';
        } else {
          console.log(`[Agent] PDF text extracted (${pdfText.length} chars).`);
        }

        console.log(`[Agent] Scoring ${applicant.name}...`);
        const profileText = applicant.resumeText ?? '';
        const combinedText = [
          profileText ? `--- Indeed Profile ---\n${profileText}` : '',
          pdfText ? `--- Resume (PDF) ---\n${pdfText}` : '',
        ].filter(Boolean).join('\n\n');
        const applicantForScoring = { ...applicant, resumeText: combinedText };
        let score;
        try {
          score = await this.scorer(applicantForScoring, this.config);
          console.log(`[Agent] Score: ${score.score}/100 — ${score.recommendation} (${score.tier})`);
        } catch (scoreErr) {
          console.error(`[Agent] Scoring failed for ${applicant.name}: ${scoreErr instanceof Error ? scoreErr.message : scoreErr}`);
          result.scoreFailures.push(applicant.name);
          score = { score: 0, recommendation: 'Pass' as const, tier: 'Tier 4' as const, keyStrengths: '', concerns: '', interviewQuestions: '' };
        }

        console.log(`[Agent] Copying interview template...`);
        await this.drive.copyTemplate(
          this.config.google_drive.interview_template_sheet_id,
          folderId,
          `Interview Questions: ${nameLabel} - ${today()}`
        );

        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
        console.log(`[Agent] Drive folder ready: ${folderUrl}`);

        const row = this.buildRow(applicant, screening, 'Awaiting Review');
        row.driveFolder = folderUrl;
        row.agentRecommendation = screening.decision;
        row.humanDecision = '';
        row.indeedId = applicant.id;
        const priorNote = priorContact ? `[Previously contacted: ${priorContact}] ` : '';
        row.notes = `${priorNote}${pdfNote}${screening.reasons.join('; ')}`;
        row.score = String(score.score);
        row.scoreRecommendation = score.recommendation;
        row.scoreTier = score.tier;
        row.keyStrengths = score.keyStrengths;
        row.scoreConcerns = score.concerns;
        row.interviewQuestions = score.interviewQuestions;

        console.log(`[Agent] Adding to Active sheet...`);
        await this.sheets.addCandidate('Active', row);

        if (screening.decision === 'PASS') {
          result.passed.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: screening.extractedData.experienceTypes.join(', '),
            certifications: screening.extractedData.certifications.join(', '),
          });
          if (screening.isUrgent) {
            console.log(`[Agent] Strong candidate — posting Slack alert.`);
            await this.slack.post(
              this.config.slack.recruiting_channel,
              `🚨 *Strong candidate:* ${applicant.name} — CNA + ${screening.extractedData.yearsExperience}yr experience\n${applicant.indeedProfileUrl}`
            );
          }
        } else if (screening.decision === 'FAIL') {
          result.rejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            reason: screening.reasons.join('; '),
          });
        } else {
          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            unclearField: screening.reasons.join('; '),
          });
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `❓ *Review needed:* ${applicant.name} — ${screening.reasons.join('; ')}\n${applicant.indeedProfileUrl}`
          );
        }

        console.log(`[Agent] Done with ${applicant.name}.`);
        markProcessed(applicant.id);

      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Agent] ERROR processing ${applicant.name}: ${reason}`);
        result.errors.push({
          description: `Failed to process ${applicant.name}`,
          reason,
          action: 'Candidate skipped — manual review needed',
        });
      }
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - startedAt.getTime();
    return result;
  }

  async processPendingDecisions(): Promise<void> {
    const candidates = await this.sheets.getCandidatesForAction();
    console.log(`\n[Agent] ${candidates.length} candidate(s) with pending human decisions.`);

    for (const candidate of candidates) {
      const decision = candidate.humanDecision.trim().toLowerCase();
      const folderId = candidate.driveFolder?.match(/folders\/([^/?]+)/)?.[1];
      const firstName = candidate.name.includes(',')
        ? candidate.name.split(',')[1]?.trim() ?? candidate.name
        : candidate.name.split(' ')[0] ?? candidate.name;
      const lastName = candidate.name.includes(',')
        ? candidate.name.split(',')[0]?.trim() ?? ''
        : candidate.name.split(' ').slice(1).join(' ');
      console.log(`[Agent] Acting on ${candidate.name}: ${candidate.humanDecision.trim()}`);

      try {
        if (decision === 'approve') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

          console.log(`[Agent] Marking sentiment "yes" on Indeed...`);
          await this.indeed.markSentiment(candidate.indeedId, 'yes');

          console.log(`[Agent] Setting up interview for ${candidate.name}...`);
          await this.indeed.setupInterview(candidate.indeedId, {
            message: renderTemplate(this.config.messages.interview_request, {
              FIRST_NAME: firstName,
              LAST_NAME: lastName,
            }),
            hiringTeamEmails: this.config.scheduling.hiring_team_emails,
          });

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to recruiting root...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.recruiting_root_folder_id);
          }

          await this.sheets.updateCandidateStatus(
            candidate.name, 'Screened - Invite Sent', { lastContact: today() }
          );

          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (approved).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Approved - interview sent',
            indeedId: candidate.indeedId,
          });

        } else if (decision === 'reject') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

          console.log(`[Agent] Marking sentiment "no" on Indeed (automated follow-up sends in 3 days)...`);
          await this.indeed.markSentiment(candidate.indeedId, 'no');

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to _Rejected...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.rejected_folder_id);
          }

          console.log(`[Agent] Moving row to Rejected tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Rejected');

          console.log(`[Agent] Recording ${candidate.name} in Previously Contacted tab (rejected).`);
          await this.sheets.addToPreviouslyContacted({
            name: candidate.name,
            lastContact: today(),
            notes: 'Rejected',
            indeedId: candidate.indeedId,
          });

        } else if (decision === 'checkback later') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name}...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });

          console.log(`[Agent] Marking sentiment "yes" on Indeed...`);
          await this.indeed.markSentiment(candidate.indeedId, 'yes');

          if (folderId) {
            console.log(`[Agent] Moving Drive folder to _Checkback Later...`);
            await this.drive.moveFolder(folderId, this.config.google_drive.checkback_folder_id);
          }

          console.log(`[Agent] Moving row to Checkback Later tab...`);
          await this.sheets.moveCandidate(candidate.name, 'Active', 'Checkback Later');

        } else if (decision === 'hold') {
          console.log(`[Agent] Clearing humanDecision for ${candidate.name} and posting Slack alert...`);
          await this.sheets.updateCandidateStatus(candidate.name, candidate.status, { humanDecision: '' });
          await this.slack.post(
            this.config.slack.recruiting_channel,
            `🚩 *Hold for review:* ${candidate.name} — Agent: ${candidate.agentRecommendation}\n${candidate.notes}\n${candidate.indeedUrl}`
          );
        } else {
          console.warn(`[Agent] Unrecognized humanDecision for ${candidate.name}: "${candidate.humanDecision.trim()}" — skipping. Valid values: Approve, Reject, Checkback Later, Hold`);
          continue;
        }

        console.log(`[Agent] Done acting on ${candidate.name}.`);
      } catch (err) {
        console.error(`[Agent] Error acting on ${candidate.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async processBookedInterviews(): Promise<void> {
    console.log('\n[Agent] Checking for booked interviews...');
    const interviews = await this.indeed.getBookedInterviews();
    console.log(`[Agent] ${interviews.length} booked interview(s) found on Indeed.`);

    const activeCandidates = await this.sheets.getActiveCandidates();
    const byIndeedId = new Map(activeCandidates.map(c => [c.indeedId, c]));

    for (const interview of interviews) {
      const candidate = byIndeedId.get(interview.applicantId);
      if (!candidate) {
        console.log(`[Agent] No matching candidate for applicantId=${interview.applicantId} — skipping.`);
        continue;
      }
      if (candidate.status === 'Interview Scheduled') {
        console.log(`[Agent] ${candidate.name} already at Interview Scheduled — skipping.`);
        continue;
      }
      console.log(`[Agent] Interview booked: ${candidate.name} — ${interview.scheduledAt}`);
      await this.sheets.updateCandidateStatus(candidate.name, 'Interview Scheduled', { lastContact: today() });
      await this.slack.post(
        this.config.slack.recruiting_channel,
        `🗓 *Interview scheduled:* ${candidate.name} — ${interview.scheduledAt}\n<${candidate.indeedUrl}|Open on Indeed>${candidate.driveFolder ? `  |  <${candidate.driveFolder}|Open on Google Drive>` : ''}`
      );
    }
  }

  async run(
    since: Date,
    processedIds: Set<string> = new Set(),
    markProcessed: (id: string) => void = () => {},
  ): Promise<RunResult> {
    const result = await this.evaluateCandidates(since, processedIds, markProcessed);
    await this.processPendingDecisions();
    return result;
  }

  private buildRow(
    applicant: { name: string; phone?: string; email?: string; indeedProfileUrl: string },
    screening: { extractedData: { location?: string | null; experienceTypes: string[]; certifications: string[] } },
    status: CandidateStatus
  ): CandidateRow {
    return {
      name: applicant.name,
      phone: applicant.phone ?? '',
      email: applicant.email ?? '',
      indeedUrl: applicant.indeedProfileUrl,
      indeedId: '',
      location: screening.extractedData.location ?? '',
      experience: screening.extractedData.experienceTypes.join(', '),
      certifications: screening.extractedData.certifications.join(', '),
      agentRecommendation: '',
      status,
      lastContact: today(),
      driveFolder: '',
      humanDecision: '',
      notes: '',
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/pipeline.test.ts
```

Expected: all tests pass including the two new scoring tests.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent.ts tests/pipeline.test.ts
git commit -m "feat(agent): add scorer injection, PDF extraction, and score fields on candidate row"
```

---

## Task 8: Update src/logger.ts

Extend `formatRunLog` to surface PDF and score failure counts in the end-of-run summary.

**Files:**
- Modify: `src/logger.ts`

- [ ] **Step 1: Add PDF and score failure sections to formatRunLog**

In `src/logger.ts`, locate the `formatRunLog` function. Find the `ERRORS` block near the bottom:

```ts
  lines.push('', `ERRORS (${result.errors.length})`);
  for (const e of result.errors) {
    lines.push(`  ✗ ${e.description}`, `    Reason: ${e.reason}`, `    Action: ${e.action}`);
  }
```

Replace it with:

```ts
  lines.push('', `ERRORS (${result.errors.length})`);
  for (const e of result.errors) {
    lines.push(`  ✗ ${e.description}`, `    Reason: ${e.reason}`, `    Action: ${e.action}`);
  }

  if (result.pdfFailures.length > 0) {
    lines.push('', `PDF EXTRACTION FAILURES (${result.pdfFailures.length})`);
    for (const name of result.pdfFailures) {
      lines.push(`  ✗ ${name} — PDF text could not be extracted (noted in sheet)`);
    }
  }

  if (result.scoreFailures.length > 0) {
    lines.push('', `SCORE FAILURES (${result.scoreFailures.length})`);
    for (const name of result.scoreFailures) {
      lines.push(`  ✗ ${name} — scoring failed, fallback score of 0 used`);
    }
  }
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/logger.ts
git commit -m "feat(logger): add PDF and score failure sections to run summary"
```

---

## Task 9: Wire up in index.ts and run-candidates.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/run-candidates.ts`

- [ ] **Step 1: Update src/index.ts**

Add the `scoreApplicant` import after the `screenApplicant` import:

```ts
import { screenApplicant } from './screening.js';
import { scoreApplicant } from './scorer.js';
```

Update the `new Agent(...)` call:

```ts
// Before:
const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, config);

// After:
const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, scoreApplicant, config);
```

- [ ] **Step 2: Update src/run-candidates.ts**

Apply the same two changes as Step 1 (same import, same constructor call update).

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/run-candidates.ts
git commit -m "feat: wire up scoreApplicant in index and run-candidates entry points"
```

---

## Done

At this point:
- `npm test` passes all tests
- Each candidate processed by the agent gets a 0–100 score, recommendation, tier, strengths, concerns, and interview questions written to the Active sheet
- PDF extraction failures are noted in the candidate's notes column and listed in the end-of-run console summary
- `scoreApplicant` and `extractPdfText` are standalone functions ready for a future re-score script
