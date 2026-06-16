# Candidate Scoring Feature — Design Spec

**Date:** 2026-06-15
**Status:** Approved

---

## Problem

The agent currently produces a PASS/FAIL/UNSURE decision based on hard rules (distance, license/transportation). Reviewers have no quantitative signal about candidate quality — they see the agent recommendation and a notes blurb, but no structured evaluation of caregiving experience, reliability, or fit. This makes it hard to prioritize candidates in the "Awaiting Review" queue.

---

## Goal

Add a rubric-based score (0–100) and supporting detail to each candidate row so reviewers can quickly gauge quality without opening the Indeed profile or Drive folder. Scoring is supplemental — the rule-based PASS/FAIL/UNSURE decision remains unchanged.

---

## Architecture

Two new modules handle scoring concerns independently of the existing screening pipeline:

### `src/pdf.ts`

Exports a single standalone function:

```ts
export async function extractPdfText(buffer: Buffer): Promise<string>
```

Uses `pdf-parse` to extract text from a resume PDF. Returns an empty string on failure (caller detects failure by checking `=== ''`). Logs parse errors to the console. Being standalone means a future re-score script can call it directly without going through the agent pipeline.

### `src/scorer.ts`

Exports a single standalone function:

```ts
export async function scoreApplicant(applicant: Applicant, config: Config): Promise<ScoreResult>
```

Assembles a Claude prompt from:
- `src/scoring-prompt.md` template (with `[PASTE SCREENING GUIDE]`, `[PASTE SCORING RUBRIC]`, `[PASTE RESUME HERE]`, and `[PASTE CANDIDATE PROFILE HERE]` placeholders replaced)
- `src/scoring-screening-guide.md` — the screening guide content
- `src/scoring-structure.md` — the scoring rubric
- `applicant.resumeText` — the combined profile text from Indeed (Experience + Education + Skills etc.) plus any PDF-extracted resume text, separated clearly
- Returns a parsed `ScoreResult`. On parse failure, returns a zeroed-out fallback (`score: 0`, `recommendation: 'Pass'`) and logs to console.

The function is designed to be callable standalone — no dependency on `ScreeningResult` — so that a future script can re-score existing sheet rows by loading an applicant object and calling this directly.

### `src/agent.ts` changes

In `evaluateCandidates`, after downloading the resume:

1. Call `extractPdfText(resume)` — if result is `''`, append `"[PDF text extraction failed]"` to the candidate's notes and record the name for the end-of-run summary
2. Attach extracted PDF text to `applicant.resumeText` alongside the Indeed profile text (clearly labeled)
3. Call `scoreApplicant(applicant, config)` after `screenApplicant`
4. Merge score fields onto the `CandidateRow` before calling `addCandidate`
5. At the end of the run, print a job summary to the console including PDF failure count and affected candidate names

### `src/adapters/sheets.ts` changes

- `COLUMNS` array extended with 6 new fields (appended after `notes`)
- All range strings updated from `A:N` (14 cols) to `A:T` (20 cols)
- No new adapter methods needed — `updateCandidateStatus` with `extras?: Partial<CandidateRow>` already supports writing any column by key, which is sufficient for a future re-score script

---

## Data Model

### New `ScoreResult` type (`src/types.ts`)

```ts
export interface ScoreResult {
  score: number;                  // 0–100
  recommendation: 'Strong Interview' | 'Interview' | 'Maybe' | 'Pass';
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';
  keyStrengths: string;
  concerns: string;
  interviewQuestions: string;     // semicolon-separated
}
```

### `CandidateRow` additions (`src/types.ts`)

Six new optional fields appended after `notes`:

```ts
score?: string;                   // "72"
scoreRecommendation?: string;     // "Strong Interview"
scoreTier?: string;               // "Tier 2"
keyStrengths?: string;
scoreConcerns?: string;
interviewQuestions?: string;
```

### Sheet column order (A–T)

| Col | Field |
|-----|-------|
| A | name |
| B | phone |
| C | email |
| D | indeedUrl |
| E | indeedId |
| F | location |
| G | experience |
| H | certifications |
| I | agentRecommendation |
| J | status |
| K | lastContact |
| L | driveFolder |
| M | humanDecision |
| N | notes |
| O | score |
| P | scoreRecommendation |
| Q | scoreTier |
| R | keyStrengths |
| S | scoreConcerns |
| T | interviewQuestions |

---

## Error Handling

| Failure | Behavior |
|---------|----------|
| PDF text extraction fails | `extractPdfText` returns `''`; agent appends `"[PDF text extraction failed]"` to notes column; name added to end-of-run failure list |
| Scorer LLM call fails | `scoreApplicant` logs error and returns zeroed fallback (`score: 0`, `recommendation: 'Pass'`, empty strings for text fields) |
| Scorer response unparseable | Same as above — conservative fallback, no hard crash |

PDF failures appear in two places: the candidate's notes column (visible to reviewers in the sheet) and the console job summary at the end of the run.

---

## End-of-Run Console Summary

The existing run already logs counts of passed/rejected/unsure. The summary will be extended to include:

- Count of candidates scored
- Count of PDF extraction failures + candidate names
- Count of scorer failures (if any)

---

## Alternatives Considered

### Option A — Extend `screening.ts`

Add scoring as a second LLM call inside `screening.ts`, returning both `ScreeningResult` and `ScoreResult` from the same function. Simpler to find everything in one place, but `screening.ts` ends up mixing two concerns: structured data extraction + rule application vs. rubric-based scoring. Harder to tune the scoring prompt without affecting the gating logic.

### Option C — Single unified LLM call

Replace `extractProfile` + `applyRules` + scoring with one large prompt that returns everything. Fewer API calls and potentially cheaper, but the prompt becomes complex and difficult to tune. The two concerns (pass/fail gating vs. reviewer scoring) evolve at different rates and for different reasons — coupling them in one prompt creates maintenance risk.

---

## Future Work

- **Re-score existing candidates**: A standalone script can load candidates from the sheet, fetch their resume from Drive, call `extractPdfText` + `scoreApplicant`, and write score columns back using `updateCandidateStatus` with `extras`. No new adapter methods needed.
- **Score-based routing**: Once scores are validated against real hiring outcomes, the score could inform auto-routing decisions (e.g., auto-approve Tier 1 Strong Interview candidates).
