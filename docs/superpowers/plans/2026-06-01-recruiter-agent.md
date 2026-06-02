# Recruiter Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manually-triggered TypeScript agent that screens caregiver applicants from Indeed, tracks them in Google Sheets, organizes Drive folders, and alerts a Slack channel.

**Architecture:** TypeScript drives the pipeline step-by-step using adapter interfaces for all external services (Indeed/Playwright, Google Sheets, Google Drive, Slack). Claude is invoked only for resume parsing and screening decisions. Fake adapters enable full pipeline testing without hitting any real service.

**Tech Stack:** TypeScript, Node.js, Anthropic SDK (`@anthropic-ai/sdk`), Playwright, `googleapis`, `@slack/web-api`, `js-yaml`, Vitest

---

## File Map

```
recruiter-agent/
├── src/
│   ├── types.ts                  # All shared types and adapter interfaces
│   ├── config.ts                 # Config loading and validation
│   ├── state.ts                  # Last-run timestamp (state.json)
│   ├── screening.ts              # Resume parsing (Claude) + rule application
│   ├── messages.ts               # Message template rendering
│   ├── logger.ts                 # Run log formatter
│   ├── agent.ts                  # Pipeline orchestrator
│   ├── adapters/
│   │   ├── indeed.ts             # Playwright browser adapter
│   │   ├── sheets.ts             # Google Sheets API adapter
│   │   ├── drive.ts              # Google Drive API adapter
│   │   └── slack.ts              # Slack Web API adapter
│   └── fakes/
│       ├── indeed.fake.ts        # In-memory test stub
│       ├── sheets.fake.ts
│       ├── drive.fake.ts
│       └── slack.fake.ts
├── tests/
│   ├── config.test.ts
│   ├── state.test.ts
│   ├── screening.test.ts         # Tests applyRules (pure, no Claude call)
│   ├── messages.test.ts
│   ├── logger.test.ts
│   └── pipeline.test.ts          # Full agent run with fakes
├── smoke/
│   ├── slack.smoke.ts            # Manual live verification
│   ├── sheets.smoke.ts
│   └── drive.smoke.ts
├── config.yaml                   # Your settings (in git)
├── config.yaml.example           # Template with empty IDs
├── state.json                    # Gitignored — last run timestamp
├── .env                          # Gitignored — API keys
├── .env.example                  # Template
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `config.yaml.example`
- Create: `config.yaml`

- [ ] **Step 1: Initialize npm and install dependencies**

```bash
npm init -y
npm install @anthropic-ai/sdk googleapis @slack/web-api playwright js-yaml
npm install -D typescript ts-node @types/node @types/js-yaml vitest
npx playwright install chromium
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*", "smoke/**/*"]
}
```

- [ ] **Step 3: Write `package.json` scripts section**

Replace the `scripts` field in the generated `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "start": "node --loader ts-node/esm src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
.env
state.json
*.smoke.ts.log
```

- [ ] **Step 5: Write `.env.example`**

```
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
GOOGLE_SERVICE_ACCOUNT_PATH=./service-account.json
INDEED_EMAIL=
INDEED_PASSWORD=
```

- [ ] **Step 6: Write `config.yaml.example`**

```yaml
run:
  trigger: manual
  max_candidates_per_run: 10

screening:
  required:
    - valid_license_and_transportation
    - within_20_miles_south_jordan
  preferred:
    - cna_certification
    - cpr_first_aid
    - home_care_experience
    - care_facility_experience
    - family_caregiving_experience
  disqualifying: []

scheduling:
  cold_candidate_days: 3

messages:
  intro: "Hi {name}, thank you for applying to Firstlight Home Care of South Jordan! We'd love to set up a quick phone screen. Please use the link below to schedule a time that works for you."
  rejection: "Hi {name}, thank you for your interest in Firstlight Home Care. After reviewing your application, we don't have a position that's the right fit at this time. We wish you the best in your search."

google_drive:
  recruiting_root_folder_id: ""
  checkback_folder_id: ""
  rejected_folder_id: ""
  interview_template_sheet_id: ""
  run_log_doc_id: ""

google_sheets:
  tracker_spreadsheet_id: ""

slack:
  recruiting_channel: "#recruiting"
```

- [ ] **Step 7: Copy example files**

```bash
cp config.yaml.example config.yaml
cp .env.example .env
```

- [ ] **Step 8: Create directory structure**

```bash
mkdir -p src/adapters src/fakes tests smoke
```

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example config.yaml.example config.yaml
git commit -m "feat: project scaffolding"
```

---

## Task 2: Shared Types and Adapter Interfaces

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
// --- Domain types ---

export interface Applicant {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  location?: string;
  resumeText?: string;
  appliedAt: Date;
  indeedProfileUrl: string;
}

export interface Interview {
  applicantId: string;
  applicantName: string;
  scheduledAt: Date;
  indeedInterviewId: string;
}

export type CandidateStatus =
  | 'Screened - Invite Sent'
  | 'Interview Scheduled'
  | 'Cold'
  | 'UNSURE';

export interface CandidateRow {
  name: string;
  phone: string;
  email: string;
  indeedUrl: string;
  location: string;
  experience: string;
  certifications: string;
  status: CandidateStatus;
  lastContact: string; // YYYY-MM-DD
  driveFolder?: string;
  notes: string;
}

export type ExperienceType = 'home_care' | 'care_facility' | 'family' | 'none';

export interface ExtractedProfile {
  location: string | null;
  distanceMiles: number | null;
  hasLicense: boolean | null;
  hasTransportation: boolean | null;
  certifications: string[];
  experienceTypes: ExperienceType[];
  yearsExperience: number | null;
}

export interface ScreeningResult {
  decision: 'PASS' | 'FAIL' | 'UNSURE';
  reasons: string[];
  extractedData: ExtractedProfile;
  isUrgent: boolean;
}

// --- Run result types ---

export interface RunCandidateResult {
  name: string;
  location: string;
  experience: string;
  certifications: string;
  reason?: string;
  unclearField?: string;
}

export interface RunBookingResult {
  name: string;
  scheduledAt: Date;
  driveFolderUrl: string;
}

export interface RunColdResult {
  name: string;
  daysSinceContact: number;
}

export interface RunError {
  description: string;
  reason: string;
  action: string;
}

export interface RunResult {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  newApplicantsReviewed: number;
  remainingApplicants: number;
  passed: RunCandidateResult[];
  rejected: RunCandidateResult[];
  unsure: RunCandidateResult[];
  bookings: RunBookingResult[];
  coldCandidates: RunColdResult[];
  errors: RunError[];
  configVersion: string;
  screeningCriteria: {
    required: string[];
    preferred: string[];
  };
}

// --- Adapter interfaces ---

export interface IndeedAdapter {
  getNewApplications(since: Date): Promise<Applicant[]>;
  sendMessage(applicantId: string, message: string): Promise<void>;
  triggerScheduler(applicantId: string): Promise<void>;
  getBookedInterviews(): Promise<Interview[]>;
  downloadResume(applicantId: string): Promise<Buffer>;
}

export interface SheetsAdapter {
  addCandidate(tab: string, candidate: CandidateRow): Promise<void>;
  updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void>;
  getActiveCandidates(): Promise<CandidateRow[]>;
}

export interface DriveAdapter {
  createFolder(name: string, parentId: string): Promise<string>;
  moveFolder(folderId: string, targetParentId: string): Promise<void>;
  uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void>;
  copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void>;
}

export interface SlackAdapter {
  post(channel: string, message: string): Promise<void>;
}

export type Screener = (applicant: Applicant, config: Config) => Promise<ScreeningResult>;

// --- Config type (mirrors config.yaml) ---

export interface Config {
  run: {
    trigger: 'manual' | 'cron';
    max_candidates_per_run: number | null;
  };
  screening: {
    required: string[];
    preferred: string[];
    disqualifying: string[];
  };
  scheduling: {
    cold_candidate_days: number;
  };
  messages: {
    intro: string;
    rejection: string;
  };
  google_drive: {
    recruiting_root_folder_id: string;
    checkback_folder_id: string;
    rejected_folder_id: string;
    interview_template_sheet_id: string;
    run_log_doc_id: string;
  };
  google_sheets: {
    tracker_spreadsheet_id: string;
  };
  slack: {
    recruiting_channel: string;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared types and adapter interfaces"
```

---

## Task 3: Config Loading

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { loadConfig } from '../src/config.js';

const TEST_CONFIG_PATH = 'test-config.yaml';

const validYaml = `
run:
  trigger: manual
  max_candidates_per_run: 10
screening:
  required:
    - valid_license_and_transportation
    - within_20_miles_south_jordan
  preferred:
    - cna_certification
  disqualifying: []
scheduling:
  cold_candidate_days: 3
messages:
  intro: "Hi {name}, thanks!"
  rejection: "Hi {name}, no thanks."
google_drive:
  recruiting_root_folder_id: "root-id"
  checkback_folder_id: "checkback-id"
  rejected_folder_id: "rejected-id"
  interview_template_sheet_id: "template-id"
  run_log_doc_id: "log-id"
google_sheets:
  tracker_spreadsheet_id: "sheet-id"
slack:
  recruiting_channel: "#recruiting"
`;

beforeEach(() => writeFileSync(TEST_CONFIG_PATH, validYaml));
afterEach(() => { if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH); });

describe('loadConfig', () => {
  it('parses a valid config file', () => {
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.run.trigger).toBe('manual');
    expect(config.run.max_candidates_per_run).toBe(10);
    expect(config.screening.required).toContain('within_20_miles_south_jordan');
    expect(config.scheduling.cold_candidate_days).toBe(3);
    expect(config.slack.recruiting_channel).toBe('#recruiting');
  });

  it('throws when a required field is missing', () => {
    writeFileSync(TEST_CONFIG_PATH, validYaml.replace('recruiting_root_folder_id: "root-id"', 'recruiting_root_folder_id: ""'));
    expect(() => loadConfig(TEST_CONFIG_PATH)).toThrow('google_drive.recruiting_root_folder_id');
  });

  it('allows null max_candidates_per_run', () => {
    writeFileSync(TEST_CONFIG_PATH, validYaml.replace('max_candidates_per_run: 10', 'max_candidates_per_run: ~'));
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.run.max_candidates_per_run).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Write `src/config.ts`**

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import type { Config } from './types.js';

export function loadConfig(configPath = 'config.yaml'): Config {
  const raw = readFileSync(resolve(configPath), 'utf8');
  const parsed = yaml.load(raw) as Config;
  validateConfig(parsed);
  return parsed;
}

const REQUIRED_FIELDS: [string, string][] = [
  ['run', 'trigger'],
  ['screening', 'required'],
  ['scheduling', 'cold_candidate_days'],
  ['messages', 'intro'],
  ['messages', 'rejection'],
  ['google_drive', 'recruiting_root_folder_id'],
  ['google_drive', 'checkback_folder_id'],
  ['google_drive', 'rejected_folder_id'],
  ['google_drive', 'interview_template_sheet_id'],
  ['google_drive', 'run_log_doc_id'],
  ['google_sheets', 'tracker_spreadsheet_id'],
  ['slack', 'recruiting_channel'],
];

function validateConfig(config: Config): void {
  for (const [section, key] of REQUIRED_FIELDS) {
    const value = (config as Record<string, Record<string, unknown>>)[section]?.[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required config: ${section}.${key}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/config.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config loading with validation"
```

---

## Task 4: State Management

**Files:**
- Create: `src/state.ts`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/state.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { readState, writeState } from '../src/state.js';

const TEST_STATE_PATH = 'test-state.json';

afterEach(() => { if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH); });

describe('state', () => {
  it('returns null when state file does not exist', () => {
    expect(readState(TEST_STATE_PATH)).toBeNull();
  });

  it('writes and reads back a timestamp', () => {
    const date = new Date('2026-06-01T10:00:00Z');
    writeState({ lastRunAt: date.toISOString() }, TEST_STATE_PATH);
    const state = readState(TEST_STATE_PATH);
    expect(state?.lastRunAt).toBe('2026-06-01T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/state.test.ts
```

Expected: FAIL — `Cannot find module '../src/state.js'`

- [ ] **Step 3: Write `src/state.ts`**

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export interface State {
  lastRunAt: string;
}

export function readState(statePath = 'state.json'): State | null {
  const path = resolve(statePath);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as State;
}

export function writeState(state: State, statePath = 'state.json'): void {
  writeFileSync(resolve(statePath), JSON.stringify(state, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/state.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: state file management"
```

---

## Task 5: Screening Rules (Pure Function)

**Files:**
- Create: `src/screening.ts`
- Create: `tests/screening.test.ts`

Note: `screenApplicant` (which calls Claude) is also in this file but is tested via the pipeline test with a fake screener. This task only tests `applyRules`, which is a pure function.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/screening.test.ts
import { describe, it, expect } from 'vitest';
import { applyRules } from '../src/screening.js';
import type { ExtractedProfile, Config } from '../src/types.js';

const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null },
  screening: {
    required: ['valid_license_and_transportation', 'within_20_miles_south_jordan'],
    preferred: ['cna_certification', 'home_care_experience'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3 },
  messages: { intro: '', rejection: '' },
  google_drive: {
    recruiting_root_folder_id: 'x', checkback_folder_id: 'x',
    rejected_folder_id: 'x', interview_template_sheet_id: 'x', run_log_doc_id: 'x',
  },
  google_sheets: { tracker_spreadsheet_id: 'x' },
  slack: { recruiting_channel: '#recruiting' },
};

function makeProfile(overrides: Partial<ExtractedProfile> = {}): ExtractedProfile {
  return {
    location: 'Sandy, UT',
    distanceMiles: 5,
    hasLicense: true,
    hasTransportation: true,
    certifications: [],
    experienceTypes: ['home_care'],
    yearsExperience: 1,
    ...overrides,
  };
}

describe('applyRules', () => {
  it('returns PASS for a candidate who meets all required criteria', () => {
    const result = applyRules(makeProfile(), config);
    expect(result.decision).toBe('PASS');
    expect(result.reasons).toHaveLength(0);
  });

  it('returns FAIL when candidate is too far away', () => {
    const result = applyRules(makeProfile({ distanceMiles: 35 }), config);
    expect(result.decision).toBe('FAIL');
    expect(result.reasons[0]).toContain('35 miles');
  });

  it('returns UNSURE when distance cannot be determined', () => {
    const result = applyRules(makeProfile({ distanceMiles: null }), config);
    expect(result.decision).toBe('UNSURE');
    expect(result.reasons[0]).toContain('distance');
  });

  it('returns FAIL when candidate has no license', () => {
    const result = applyRules(makeProfile({ hasLicense: false }), config);
    expect(result.decision).toBe('FAIL');
    expect(result.reasons[0]).toContain('license');
  });

  it('returns UNSURE when license info is missing', () => {
    const result = applyRules(makeProfile({ hasLicense: null }), config);
    expect(result.decision).toBe('UNSURE');
  });

  it('FAIL takes precedence over UNSURE', () => {
    const result = applyRules(makeProfile({ distanceMiles: 35, hasLicense: null }), config);
    expect(result.decision).toBe('FAIL');
  });

  it('sets isUrgent=true for CNA with 1+ year home care experience', () => {
    const result = applyRules(makeProfile({ certifications: ['CNA'], yearsExperience: 2 }), config);
    expect(result.isUrgent).toBe(true);
  });

  it('sets isUrgent=true for CNA with care facility experience', () => {
    const result = applyRules(
      makeProfile({ certifications: ['CNA'], experienceTypes: ['care_facility'], yearsExperience: 1 }),
      config
    );
    expect(result.isUrgent).toBe(true);
  });

  it('sets isUrgent=false when no CNA', () => {
    const result = applyRules(makeProfile({ certifications: [], yearsExperience: 5 }), config);
    expect(result.isUrgent).toBe(false);
  });

  it('sets isUrgent=false when CNA but less than 1 year experience', () => {
    const result = applyRules(makeProfile({ certifications: ['CNA'], yearsExperience: 0 }), config);
    expect(result.isUrgent).toBe(false);
  });

  it('passes candidates with only family care experience', () => {
    const result = applyRules(makeProfile({ experienceTypes: ['family'] }), config);
    expect(result.decision).toBe('PASS');
  });

  it('passes candidates with no experience (not a disqualifier)', () => {
    const result = applyRules(makeProfile({ experienceTypes: ['none'] }), config);
    expect(result.decision).toBe('PASS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/screening.test.ts
```

Expected: FAIL — `Cannot find module '../src/screening.js'`

- [ ] **Step 3: Write `src/screening.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Applicant, ScreeningResult, ExtractedProfile, Config } from './types.js';

const client = new Anthropic();

export async function screenApplicant(applicant: Applicant, config: Config): Promise<ScreeningResult> {
  const profile = await extractProfile(applicant);
  return applyRules(profile, config);
}

async function extractProfile(applicant: Applicant): Promise<ExtractedProfile> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract structured information from this job applicant's profile. Return ONLY valid JSON with no markdown.

Name: ${applicant.name}
Location on profile: ${applicant.location ?? 'not provided'}
Resume text: ${applicant.resumeText ?? 'not provided'}

Return exactly this JSON structure:
{
  "location": "city, state string or null if not found",
  "distanceMiles": estimated driving miles from South Jordan Utah (84095) as a number, or null if you cannot determine location,
  "hasLicense": true if they mention valid driver's license, false if they say they don't have one, null if not mentioned,
  "hasTransportation": true if they mention reliable transportation or a car, false if they say they don't have transportation, null if not mentioned,
  "certifications": array of strings from this list only: ["CNA", "CPR", "First Aid"] — only include ones explicitly mentioned,
  "experienceTypes": array from ["home_care", "care_facility", "family", "none"] — include all that apply based on their work history,
  "yearsExperience": total years of direct care experience as a number, or null if cannot determine
}`
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return JSON.parse(text) as ExtractedProfile;
}

export function applyRules(profile: ExtractedProfile, config: Config): ScreeningResult {
  const reasons: string[] = [];
  let decision: 'PASS' | 'FAIL' | 'UNSURE' = 'PASS';

  const required = config.screening.required;

  if (required.includes('within_20_miles_south_jordan')) {
    if (profile.distanceMiles === null) {
      if (decision !== 'FAIL') decision = 'UNSURE';
      reasons.push('Could not determine distance from South Jordan');
    } else if (profile.distanceMiles > 20) {
      decision = 'FAIL';
      reasons.push(`Location is ${profile.distanceMiles} miles from South Jordan (max 20)`);
    }
  }

  if (required.includes('valid_license_and_transportation')) {
    if (profile.hasLicense === null || profile.hasTransportation === null) {
      if (decision !== 'FAIL') decision = 'UNSURE';
      reasons.push('Could not confirm valid license and reliable transportation');
    } else if (!profile.hasLicense || !profile.hasTransportation) {
      decision = 'FAIL';
      reasons.push('Does not have valid license and/or reliable transportation');
    }
  }

  const hasCNA = profile.certifications.map(c => c.toUpperCase()).includes('CNA');
  const hasCareExp =
    profile.experienceTypes.includes('home_care') ||
    profile.experienceTypes.includes('care_facility');
  const isUrgent = hasCNA && hasCareExp && (profile.yearsExperience ?? 0) >= 1;

  return { decision, reasons, extractedData: profile, isUrgent };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/screening.test.ts
```

Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screening.ts tests/screening.test.ts
git commit -m "feat: screening rules with Claude extraction"
```

---

## Task 6: Message Templates

**Files:**
- Create: `src/messages.ts`
- Create: `tests/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/messages.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/messages.js';

describe('renderTemplate', () => {
  it('replaces {name} with the provided value', () => {
    const result = renderTemplate('Hi {name}, thanks!', { name: 'Jane' });
    expect(result).toBe('Hi Jane, thanks!');
  });

  it('replaces multiple occurrences', () => {
    const result = renderTemplate('{name} — hey {name}!', { name: 'Jane' });
    expect(result).toBe('Jane — hey Jane!');
  });

  it('leaves unknown placeholders unchanged', () => {
    const result = renderTemplate('Hi {name}, your id is {id}', { name: 'Jane' });
    expect(result).toBe('Hi Jane, your id is {id}');
  });

  it('handles empty variables map', () => {
    const result = renderTemplate('Hello {name}', {});
    expect(result).toBe('Hello {name}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/messages.test.ts
```

Expected: FAIL — `Cannot find module '../src/messages.js'`

- [ ] **Step 3: Write `src/messages.ts`**

```typescript
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => variables[key] ?? `{${key}}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/messages.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/messages.ts tests/messages.test.ts
git commit -m "feat: message template rendering"
```

---

## Task 7: Run Logger

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/logger.test.ts
import { describe, it, expect } from 'vitest';
import { formatRunLog } from '../src/logger.js';
import type { RunResult } from '../src/types.js';

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    startedAt: new Date('2026-06-01T10:00:00Z'),
    completedAt: new Date('2026-06-01T10:04:32Z'),
    durationMs: 272000,
    newApplicantsReviewed: 2,
    remainingApplicants: 3,
    passed: [{ name: 'Jane Doe', location: 'Sandy, UT', experience: 'home_care', certifications: 'CNA' }],
    rejected: [{ name: 'Tom Harris', location: 'Provo, UT', experience: '', certifications: '', reason: 'Too far (35mi)' }],
    unsure: [],
    bookings: [],
    coldCandidates: [],
    errors: [],
    configVersion: 'abc1234',
    screeningCriteria: {
      required: ['within_20_miles_south_jordan', 'valid_license_and_transportation'],
      preferred: ['cna_certification'],
    },
    ...overrides,
  };
}

describe('formatRunLog', () => {
  it('includes the run timestamp and duration', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('2026-06-01 10:00');
    expect(log).toContain('4m 32s');
  });

  it('includes candidate counts and remaining', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('2 reviewed, 3 remaining');
  });

  it('marks passed candidates with a checkmark', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('✓ PASS');
    expect(log).toContain('Jane Doe');
  });

  it('marks rejected candidates with an X and reason', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('✗ REJECT');
    expect(log).toContain('Too far (35mi)');
  });

  it('includes config version', () => {
    const log = formatRunLog(makeResult());
    expect(log).toContain('abc1234');
  });

  it('includes errors when present', () => {
    const result = makeResult({
      errors: [{ description: 'Drive folder failed for Jane', reason: 'Permission denied', action: 'Slack alert sent' }],
    });
    const log = formatRunLog(result);
    expect(log).toContain('Drive folder failed for Jane');
    expect(log).toContain('Permission denied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/logger.test.ts
```

Expected: FAIL — `Cannot find module '../src/logger.js'`

- [ ] **Step 3: Write `src/logger.ts`**

```typescript
import { execSync } from 'child_process';
import type { RunResult } from './types.js';

export function formatRunLog(result: RunResult): string {
  const totalSecs = Math.round(result.durationMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const timestamp = result.startedAt.toISOString().slice(0, 16).replace('T', ' ');

  const lines: string[] = [
    `${timestamp} — Run complete (duration: ${mins}m ${secs}s)`,
    '',
    `NEW APPLICANTS (${result.newApplicantsReviewed} reviewed, ${result.remainingApplicants} remaining)`,
  ];

  for (const c of result.passed) {
    lines.push(`  ✓ PASS   ${pad(c.name, 22)} ${pad(c.location, 20)} ${c.certifications || c.experience}  → Intro sent`);
  }
  for (const c of result.rejected) {
    lines.push(`  ✗ REJECT  ${pad(c.name, 22)} ${pad(c.location, 20)} ${c.reason}  → Rejection sent`);
  }
  for (const c of result.unsure) {
    lines.push(`  ? UNSURE  ${pad(c.name, 22)} ${pad(c.location, 20)} ${c.unclearField}  → Slacked`);
  }

  if (result.bookings.length > 0 || result.coldCandidates.length > 0) {
    lines.push('', 'EXISTING CANDIDATES');
    for (const b of result.bookings) {
      const time = b.scheduledAt.toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`  📅 BOOKED  ${pad(b.name, 22)} Phone screen: ${time}  → Drive folder created`);
    }
    for (const c of result.coldCandidates) {
      lines.push(`  ❄ COLD    ${pad(c.name, 22)} No reply in ${c.daysSinceContact} days  → Slack alert sent`);
    }
  }

  lines.push('', `ERRORS (${result.errors.length})`);
  for (const e of result.errors) {
    lines.push(`  ✗ ${e.description}`, `    Reason: ${e.reason}`, `    Action: ${e.action}`);
  }

  lines.push(
    '',
    'SCREENING CRITERIA APPLIED',
    `  Required: ${result.screeningCriteria.required.join(', ')}`,
    `  Bonuses: ${result.screeningCriteria.preferred.join(', ')}`,
    `  Config version: config.yaml @ git commit ${result.configVersion}`,
  );

  return lines.join('\n');
}

export function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/logger.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: run log formatter"
```

---

## Task 8: Fake Adapters

**Files:**
- Create: `src/fakes/indeed.fake.ts`
- Create: `src/fakes/sheets.fake.ts`
- Create: `src/fakes/drive.fake.ts`
- Create: `src/fakes/slack.fake.ts`

No tests for fakes — they are themselves test infrastructure.

- [ ] **Step 1: Write `src/fakes/indeed.fake.ts`**

```typescript
import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class FakeIndeedAdapter implements IndeedAdapter {
  private applicants: Applicant[] = [];
  private interviews: Interview[] = [];
  sentMessages: { applicantId: string; message: string }[] = [];
  triggeredSchedulers: string[] = [];

  seedApplicants(applicants: Applicant[]): void {
    this.applicants = applicants;
  }

  seedInterviews(interviews: Interview[]): void {
    this.interviews = interviews;
  }

  async getNewApplications(since: Date): Promise<Applicant[]> {
    return this.applicants.filter(a => a.appliedAt > since);
  }

  async sendMessage(applicantId: string, message: string): Promise<void> {
    this.sentMessages.push({ applicantId, message });
  }

  async triggerScheduler(applicantId: string): Promise<void> {
    this.triggeredSchedulers.push(applicantId);
  }

  async getBookedInterviews(): Promise<Interview[]> {
    return this.interviews;
  }

  async downloadResume(applicantId: string): Promise<Buffer> {
    return Buffer.from(`Resume content for applicant ${applicantId}`);
  }
}
```

- [ ] **Step 2: Write `src/fakes/sheets.fake.ts`**

```typescript
import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

export class FakeSheetsAdapter implements SheetsAdapter {
  tabs: Record<string, CandidateRow[]> = {
    Active: [],
    Rejected: [],
    Hired: [],
    'Checkback Later': [],
    'Communication Log': [],
  };

  async addCandidate(tab: string, candidate: CandidateRow): Promise<void> {
    if (!this.tabs[tab]) this.tabs[tab] = [];
    this.tabs[tab].push({ ...candidate });
  }

  async updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void> {
    const candidate = this.tabs['Active'].find(c => c.name === name);
    if (candidate) {
      candidate.status = status;
      if (extras) Object.assign(candidate, extras);
    }
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    return [...this.tabs['Active']];
  }
}
```

- [ ] **Step 3: Write `src/fakes/drive.fake.ts`**

```typescript
import type { DriveAdapter } from '../types.js';

export class FakeDriveAdapter implements DriveAdapter {
  folders: { id: string; name: string; parentId: string }[] = [];
  files: { folderId: string; name: string; content: Buffer; mimeType: string }[] = [];
  copies: { templateId: string; destFolderId: string; name: string }[] = [];
  moves: { folderId: string; targetParentId: string }[] = [];
  private nextId = 1;

  async createFolder(name: string, parentId: string): Promise<string> {
    const id = `folder-${this.nextId++}`;
    this.folders.push({ id, name, parentId });
    return id;
  }

  async moveFolder(folderId: string, targetParentId: string): Promise<void> {
    this.moves.push({ folderId, targetParentId });
  }

  async uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void> {
    this.files.push({ folderId, name, content, mimeType });
  }

  async copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void> {
    this.copies.push({ templateId, destFolderId, name });
  }
}
```

- [ ] **Step 4: Write `src/fakes/slack.fake.ts`**

```typescript
import type { SlackAdapter } from '../types.js';

export class FakeSlackAdapter implements SlackAdapter {
  messages: { channel: string; message: string }[] = [];

  async post(channel: string, message: string): Promise<void> {
    this.messages.push({ channel, message });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/fakes/
git commit -m "feat: fake adapters for testing"
```

---

## Task 9: Agent Orchestrator

**Files:**
- Create: `src/agent.ts`

- [ ] **Step 1: Write `src/agent.ts`**

```typescript
import type {
  IndeedAdapter, SheetsAdapter, DriveAdapter, SlackAdapter,
  Screener, Config, RunResult, CandidateRow, CandidateStatus,
} from './types.js';
import { renderTemplate } from './messages.js';
import { getGitCommitHash } from './logger.js';

export class Agent {
  constructor(
    private indeed: IndeedAdapter,
    private sheets: SheetsAdapter,
    private drive: DriveAdapter,
    private slack: SlackAdapter,
    private screener: Screener,
    private config: Config,
  ) {}

  async run(since: Date): Promise<RunResult> {
    const startedAt = new Date();
    const result: RunResult = {
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      newApplicantsReviewed: 0,
      remainingApplicants: 0,
      passed: [], rejected: [], unsure: [],
      bookings: [], coldCandidates: [], errors: [],
      configVersion: getGitCommitHash(),
      screeningCriteria: {
        required: this.config.screening.required,
        preferred: this.config.screening.preferred,
      },
    };

    // Step 1: screen new applicants
    let applicants = await this.indeed.getNewApplications(since);
    const limit = this.config.run.max_candidates_per_run;
    result.remainingApplicants = limit ? Math.max(0, applicants.length - limit) : 0;
    if (limit) applicants = applicants.slice(0, limit);
    result.newApplicantsReviewed = applicants.length;

    for (const applicant of applicants) {
      try {
        const screening = await this.screener(applicant, this.config);

        if (screening.decision === 'PASS') {
          await this.indeed.sendMessage(
            applicant.id,
            renderTemplate(this.config.messages.intro, { name: applicant.firstName })
          );
          await this.indeed.triggerScheduler(applicant.id);

          await this.sheets.addCandidate('Active', this.buildRow(applicant, screening, 'Screened - Invite Sent'));

          result.passed.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: screening.extractedData.experienceTypes.join(', '),
            certifications: screening.extractedData.certifications.join(', '),
          });

          if (screening.isUrgent) {
            await this.slack.post(
              this.config.slack.recruiting_channel,
              `🚨 *Strong candidate:* ${applicant.name} — CNA + ${screening.extractedData.yearsExperience}yr experience\n${applicant.indeedProfileUrl}`
            );
          }

        } else if (screening.decision === 'FAIL') {
          await this.indeed.sendMessage(
            applicant.id,
            renderTemplate(this.config.messages.rejection, { name: applicant.firstName })
          );

          const row = this.buildRow(applicant, screening, 'Screened - Invite Sent');
          row.notes = screening.reasons.join('; ');
          await this.sheets.addCandidate('Rejected', row);

          result.rejected.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            reason: screening.reasons.join('; '),
          });

        } else {
          const row = this.buildRow(applicant, screening, 'UNSURE');
          row.notes = screening.reasons.join('; ');
          await this.sheets.addCandidate('Active', row);

          await this.slack.post(
            this.config.slack.recruiting_channel,
            `❓ *Review needed:* ${applicant.name} — ${screening.reasons.join('; ')}\n${applicant.indeedProfileUrl}`
          );

          result.unsure.push({
            name: applicant.name,
            location: screening.extractedData.location ?? '',
            experience: '', certifications: '',
            unclearField: screening.reasons.join('; '),
          });
        }

      } catch (err) {
        result.errors.push({
          description: `Failed to process ${applicant.name}`,
          reason: err instanceof Error ? err.message : String(err),
          action: 'Candidate skipped — manual review needed',
        });
      }
    }

    // Step 2: handle new interview bookings
    const interviews = await this.indeed.getBookedInterviews();
    for (const interview of interviews) {
      try {
        const nameParts = interview.applicantName.split(' ');
        const folderName = `${nameParts.slice(1).join('_')}_${nameParts[0]}_${today()}`;
        const folderId = await this.drive.createFolder(
          folderName,
          this.config.google_drive.recruiting_root_folder_id
        );

        const resume = await this.indeed.downloadResume(interview.applicantId);
        await this.drive.uploadFile(folderId, 'resume.pdf', resume, 'application/pdf');

        await this.drive.copyTemplate(
          this.config.google_drive.interview_template_sheet_id,
          folderId,
          'Interview Questions'
        );

        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

        await this.sheets.updateCandidateStatus(interview.applicantName, 'Interview Scheduled', {
          driveFolder: folderUrl,
          lastContact: today(),
        });

        await this.slack.post(
          this.config.slack.recruiting_channel,
          `📅 *Interview scheduled:* ${interview.applicantName}\nTime: ${interview.scheduledAt.toLocaleString()}\nFolder: ${folderUrl}`
        );

        result.bookings.push({
          name: interview.applicantName,
          scheduledAt: interview.scheduledAt,
          driveFolderUrl: folderUrl,
        });

      } catch (err) {
        result.errors.push({
          description: `Failed to set up Drive folder for ${interview.applicantName}`,
          reason: err instanceof Error ? err.message : String(err),
          action: 'Slack alert sent, candidate stays Active without folder link',
        });
        await this.slack.post(
          this.config.slack.recruiting_channel,
          `⚠️ *Drive folder creation failed* for ${interview.applicantName}. Manual setup needed.`
        ).catch(() => {});
      }
    }

    // Step 3: check for cold candidates
    const active = await this.sheets.getActiveCandidates();
    const coldDays = this.config.scheduling.cold_candidate_days;
    const now = new Date();

    for (const candidate of active) {
      if (candidate.status !== 'Screened - Invite Sent') continue;
      const lastContact = new Date(candidate.lastContact);
      const daysSince = Math.floor((now.getTime() - lastContact.getTime()) / 86_400_000);

      if (daysSince >= coldDays) {
        await this.sheets.updateCandidateStatus(candidate.name, 'Cold');
        await this.slack.post(
          this.config.slack.recruiting_channel,
          `❄️ *Cold candidate:* ${candidate.name} — no response in ${daysSince} days\n${candidate.indeedUrl}`
        );
        result.coldCandidates.push({ name: candidate.name, daysSinceContact: daysSince });
      }
    }

    result.completedAt = new Date();
    result.durationMs = result.completedAt.getTime() - startedAt.getTime();
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
      location: screening.extractedData.location ?? '',
      experience: screening.extractedData.experienceTypes.join(', '),
      certifications: screening.extractedData.certifications.join(', '),
      status,
      lastContact: today(),
      notes: '',
    };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent.ts
git commit -m "feat: agent pipeline orchestrator"
```

---

## Task 10: Pipeline Integration Test

**Files:**
- Create: `tests/pipeline.test.ts`

- [ ] **Step 1: Write `tests/pipeline.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { FakeIndeedAdapter } from '../src/fakes/indeed.fake.js';
import { FakeSheetsAdapter } from '../src/fakes/sheets.fake.js';
import { FakeDriveAdapter } from '../src/fakes/drive.fake.js';
import { FakeSlackAdapter } from '../src/fakes/slack.fake.js';
import type { Applicant, Config, ScreeningResult } from '../src/types.js';

const config: Config = {
  run: { trigger: 'manual', max_candidates_per_run: null },
  screening: {
    required: ['valid_license_and_transportation', 'within_20_miles_south_jordan'],
    preferred: ['cna_certification'],
    disqualifying: [],
  },
  scheduling: { cold_candidate_days: 3 },
  messages: {
    intro: 'Hi {name}, thanks for applying!',
    rejection: 'Hi {name}, we appreciate your interest.',
  },
  google_drive: {
    recruiting_root_folder_id: 'root-id',
    checkback_folder_id: 'checkback-id',
    rejected_folder_id: 'rejected-id',
    interview_template_sheet_id: 'template-id',
    run_log_doc_id: 'log-id',
  },
  google_sheets: { tracker_spreadsheet_id: 'sheet-id' },
  slack: { recruiting_channel: '#recruiting' },
};

function makeApplicant(overrides: Partial<Applicant> = {}): Applicant {
  return {
    id: 'app-1', name: 'Jane Doe', firstName: 'Jane', lastName: 'Doe',
    email: 'jane@example.com', phone: '801-555-1234', location: 'Sandy, UT',
    resumeText: 'CNA, 2 years home care',
    appliedAt: new Date('2026-06-01T08:00:00Z'),
    indeedProfileUrl: 'https://employers.indeed.com/applicants/1',
    ...overrides,
  };
}

function passResult(isUrgent = false): ScreeningResult {
  return {
    decision: 'PASS', reasons: [],
    extractedData: {
      location: 'Sandy, UT', distanceMiles: 5, hasLicense: true, hasTransportation: true,
      certifications: isUrgent ? ['CNA'] : [],
      experienceTypes: ['home_care'], yearsExperience: isUrgent ? 2 : 1,
    },
    isUrgent,
  };
}

function failResult(reason: string): ScreeningResult {
  return {
    decision: 'FAIL', reasons: [reason],
    extractedData: {
      location: 'Provo, UT', distanceMiles: 35, hasLicense: true, hasTransportation: true,
      certifications: [], experienceTypes: [], yearsExperience: null,
    },
    isUrgent: false,
  };
}

function unsureResult(field: string): ScreeningResult {
  return {
    decision: 'UNSURE', reasons: [field],
    extractedData: {
      location: null, distanceMiles: null, hasLicense: null, hasTransportation: null,
      certifications: [], experienceTypes: [], yearsExperience: null,
    },
    isUrgent: false,
  };
}

describe('Agent.run', () => {
  let indeed: FakeIndeedAdapter;
  let sheets: FakeSheetsAdapter;
  let drive: FakeDriveAdapter;
  let slack: FakeSlackAdapter;
  const since = new Date('2026-01-01');

  beforeEach(() => {
    indeed = new FakeIndeedAdapter();
    sheets = new FakeSheetsAdapter();
    drive = new FakeDriveAdapter();
    slack = new FakeSlackAdapter();
  });

  it('sends intro message, triggers scheduler, and adds to Active for PASS', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    const result = await agent.run(since);

    expect(indeed.sentMessages).toHaveLength(1);
    expect(indeed.sentMessages[0].message).toContain('Jane');
    expect(indeed.triggeredSchedulers).toContain('app-1');
    expect(sheets.tabs['Active']).toHaveLength(1);
    expect(sheets.tabs['Active'][0].status).toBe('Screened - Invite Sent');
    expect(result.passed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(slack.messages).toHaveLength(0);
  });

  it('sends rejection and adds to Rejected for FAIL — no Slack alert', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => failResult('Too far (35mi)'), config);

    await agent.run(since);

    expect(indeed.sentMessages[0].message).toContain('appreciate');
    expect(sheets.tabs['Rejected']).toHaveLength(1);
    expect(sheets.tabs['Rejected'][0].notes).toContain('Too far');
    expect(slack.messages).toHaveLength(0);
  });

  it('adds to Active as UNSURE and posts to Slack', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => unsureResult('Cannot determine distance'), config);

    await agent.run(since);

    expect(sheets.tabs['Active'][0].status).toBe('UNSURE');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].channel).toBe('#recruiting');
    expect(slack.messages[0].message).toContain('Review needed');
  });

  it('posts Slack alert for urgent/strong candidate', async () => {
    indeed.seedApplicants([makeApplicant()]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(true), config);

    await agent.run(since);

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Strong candidate');
  });

  it('creates Drive folder, uploads resume, copies template, and posts Slack on booking', async () => {
    indeed.seedInterviews([{
      applicantId: 'app-1', applicantName: 'Jane Doe',
      scheduledAt: new Date('2026-06-03T14:00:00Z'),
      indeedInterviewId: 'interview-1',
    }]);
    sheets.tabs['Active'].push({
      name: 'Jane Doe', phone: '', email: '', indeedUrl: '', location: '',
      experience: '', certifications: '', status: 'Screened - Invite Sent',
      lastContact: '2026-06-01', notes: '',
    });
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    await agent.run(new Date());

    expect(drive.folders).toHaveLength(1);
    expect(drive.folders[0].parentId).toBe('root-id');
    expect(drive.files).toHaveLength(1);
    expect(drive.files[0].name).toBe('resume.pdf');
    expect(drive.copies).toHaveLength(1);
    expect(drive.copies[0].templateId).toBe('template-id');
    const updatedCandidate = sheets.tabs['Active'].find(c => c.name === 'Jane Doe');
    expect(updatedCandidate?.status).toBe('Interview Scheduled');
    expect(updatedCandidate?.driveFolder).toContain('drive.google.com');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Interview scheduled');
  });

  it('flags cold candidate and posts Slack alert', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    sheets.tabs['Active'].push({
      name: 'Cold Carl', phone: '', email: '', indeedUrl: 'https://indeed.com/carl',
      location: '', experience: '', certifications: '',
      status: 'Screened - Invite Sent', lastContact: fourDaysAgo, notes: '',
    });
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    const result = await agent.run(new Date());

    expect(result.coldCandidates).toHaveLength(1);
    expect(result.coldCandidates[0].name).toBe('Cold Carl');
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0].message).toContain('Cold Carl');
    expect(slack.messages[0].message).toContain('cold');
  });

  it('does not flag Interview Scheduled candidates as cold', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
    sheets.tabs['Active'].push({
      name: 'Jane Scheduled', phone: '', email: '', indeedUrl: '',
      location: '', experience: '', certifications: '',
      status: 'Interview Scheduled', lastContact: fourDaysAgo, notes: '',
    });
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), config);

    const result = await agent.run(new Date());

    expect(result.coldCandidates).toHaveLength(0);
  });

  it('respects max_candidates_per_run', async () => {
    const limitedConfig = { ...config, run: { ...config.run, max_candidates_per_run: 2 } };
    indeed.seedApplicants([
      makeApplicant({ id: '1', name: 'A A', firstName: 'A', appliedAt: new Date('2026-06-01T01:00:00Z') }),
      makeApplicant({ id: '2', name: 'B B', firstName: 'B', appliedAt: new Date('2026-06-01T02:00:00Z') }),
      makeApplicant({ id: '3', name: 'C C', firstName: 'C', appliedAt: new Date('2026-06-01T03:00:00Z') }),
    ]);
    const agent = new Agent(indeed, sheets, drive, slack, async () => passResult(), limitedConfig);

    const result = await agent.run(since);

    expect(result.newApplicantsReviewed).toBe(2);
    expect(result.remainingApplicants).toBe(1);
  });

  it('records an error and continues when a candidate throws', async () => {
    indeed.seedApplicants([
      makeApplicant({ id: 'bad', name: 'Bad Actor', firstName: 'Bad' }),
      makeApplicant({ id: 'good', name: 'Good Person', firstName: 'Good' }),
    ]);
    let callCount = 0;
    const agent = new Agent(indeed, sheets, drive, slack, async () => {
      callCount++;
      if (callCount === 1) throw new Error('Simulated Claude failure');
      return passResult();
    }, config);

    const result = await agent.run(since);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].description).toContain('Bad Actor');
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].name).toBe('Good Person');
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: PASS (all tests across all files)

- [ ] **Step 3: Commit**

```bash
git add tests/pipeline.test.ts
git commit -m "test: full pipeline integration test with fakes"
```

---

## Task 11: Slack Adapter

**Files:**
- Create: `src/adapters/slack.ts`
- Create: `smoke/slack.smoke.ts`

- [ ] **Step 1: Write `src/adapters/slack.ts`**

```typescript
import { WebClient } from '@slack/web-api';
import type { SlackAdapter } from '../types.js';

export class SlackService implements SlackAdapter {
  private client: WebClient;

  constructor(token: string) {
    this.client = new WebClient(token);
  }

  async post(channel: string, message: string): Promise<void> {
    await this.client.chat.postMessage({ channel, text: message });
  }
}
```

- [ ] **Step 2: Write `smoke/slack.smoke.ts`**

```typescript
import { SlackService } from '../src/adapters/slack.js';
import 'dotenv/config';

const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error('SLACK_BOT_TOKEN not set in .env');

const slack = new SlackService(token);

console.log('Posting test message to #recruiting-test...');
await slack.post('#recruiting-test', '🤖 Recruiter agent smoke test — Slack adapter working.');
console.log('Done.');
```

- [ ] **Step 3: Install dotenv for smoke tests**

```bash
npm install dotenv
```

- [ ] **Step 4: Configure Slack bot token in `.env`**

Set `SLACK_BOT_TOKEN` in your `.env` file. The bot needs the `chat:write` OAuth scope and must be invited to `#recruiting-test`.

- [ ] **Step 5: Run smoke test manually**

```bash
node --loader ts-node/esm smoke/slack.smoke.ts
```

Expected: message appears in `#recruiting-test` channel.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/slack.ts smoke/slack.smoke.ts
git commit -m "feat: Slack adapter"
```

---

## Task 12: Google Sheets Adapter

**Files:**
- Create: `src/adapters/sheets.ts`
- Create: `smoke/sheets.smoke.ts`

- [ ] **Step 1: Create a Google service account**

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable the **Google Sheets API** and **Google Drive API**
4. Create a service account: IAM & Admin → Service Accounts → Create
5. Download the JSON key → save as `service-account.json` in project root (gitignored)
6. Share your tracker spreadsheet with the service account email (Editor role)

- [ ] **Step 2: Write `src/adapters/sheets.ts`**

```typescript
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import type { SheetsAdapter, CandidateRow, CandidateStatus } from '../types.js';

const COLUMNS = ['name','phone','email','indeedUrl','location','experience','certifications','status','lastContact','driveFolder','notes'] as const;

export class SheetsService implements SheetsAdapter {
  private auth: InstanceType<typeof google.auth.JWT>;
  private spreadsheetId: string;

  constructor(serviceAccountPath: string, spreadsheetId: string) {
    const key = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    this.auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.spreadsheetId = spreadsheetId;
  }

  async addCandidate(tab: string, candidate: CandidateRow): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: this.auth });
    const values = [COLUMNS.map(col => (candidate as Record<string, unknown>)[col] ?? '')];
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${tab}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async updateCandidateStatus(
    name: string,
    status: CandidateStatus,
    extras?: Partial<CandidateRow>
  ): Promise<void> {
    const sheets = google.sheets({ version: 'v4', auth: this.auth });
    const range = `Active!A:K`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId, range,
    });
    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex(r => r[0] === name);
    if (rowIndex === -1) return;

    const row = rows[rowIndex];
    const statusCol = COLUMNS.indexOf('status');
    const driveFolderCol = COLUMNS.indexOf('driveFolder');
    const lastContactCol = COLUMNS.indexOf('lastContact');

    row[statusCol] = status;
    if (extras?.driveFolder) row[driveFolderCol] = extras.driveFolder;
    if (extras?.lastContact) row[lastContactCol] = extras.lastContact;

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Active!A${rowIndex + 1}:K${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async getActiveCandidates(): Promise<CandidateRow[]> {
    const sheets = google.sheets({ version: 'v4', auth: this.auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Active!A2:K',
    });
    const rows = response.data.values ?? [];
    return rows.map(row => {
      const candidate: Record<string, string> = {};
      COLUMNS.forEach((col, i) => { candidate[col] = row[i] ?? ''; });
      return candidate as unknown as CandidateRow;
    });
  }
}
```

- [ ] **Step 3: Write `smoke/sheets.smoke.ts`**

```typescript
import { SheetsService } from '../src/adapters/sheets.js';
import { loadConfig } from '../src/config.js';
import 'dotenv/config';

const config = loadConfig();
const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
const sheets = new SheetsService(serviceAccountPath, config.google_sheets.tracker_spreadsheet_id);

console.log('Reading active candidates...');
const candidates = await sheets.getActiveCandidates();
console.log(`Found ${candidates.length} active candidate(s).`);

console.log('Adding test row to Active tab...');
await sheets.addCandidate('Active', {
  name: 'SMOKE TEST — DELETE ME',
  phone: '000-000-0000', email: 'test@test.com',
  indeedUrl: 'https://example.com', location: 'Test City, UT',
  experience: 'none', certifications: 'none',
  status: 'UNSURE', lastContact: new Date().toISOString().slice(0, 10),
  notes: 'Smoke test row — safe to delete',
});
console.log('Done. Check your Active tab and delete the test row.');
```

- [ ] **Step 4: Set up your spreadsheet tabs**

In Google Sheets, create tabs named exactly: `Active`, `Rejected`, `Hired`, `Checkback Later`, `Communication Log`

Add a header row to each tab matching the columns: `name | phone | email | indeedUrl | location | experience | certifications | status | lastContact | driveFolder | notes`

- [ ] **Step 5: Run smoke test manually**

```bash
node --loader ts-node/esm smoke/sheets.smoke.ts
```

Expected: sees existing candidates (0 if new), adds a test row. Delete the test row from Sheets after.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/sheets.ts smoke/sheets.smoke.ts
git commit -m "feat: Google Sheets adapter"
```

---

## Task 13: Google Drive Adapter

**Files:**
- Create: `src/adapters/drive.ts`
- Create: `smoke/drive.smoke.ts`

- [ ] **Step 1: Write `src/adapters/drive.ts`**

```typescript
import { readFileSync } from 'fs';
import { google } from 'googleapis';
import type { DriveAdapter } from '../types.js';

export class DriveService implements DriveAdapter {
  private auth: InstanceType<typeof google.auth.JWT>;

  constructor(serviceAccountPath: string) {
    const key = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    this.auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }

  async createFolder(name: string, parentId: string): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    return response.data.id!;
  }

  async moveFolder(folderId: string, targetParentId: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const file = await drive.files.get({ fileId: folderId, fields: 'parents' });
    const previousParents = (file.data.parents ?? []).join(',');
    await drive.files.update({
      fileId: folderId,
      addParents: targetParentId,
      removeParents: previousParents,
      fields: 'id, parents',
    });
  }

  async uploadFile(folderId: string, name: string, content: Buffer, mimeType: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const { Readable } = await import('stream');
    await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(content) },
      fields: 'id',
    });
  }

  async copyTemplate(templateId: string, destFolderId: string, name: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    await drive.files.copy({
      fileId: templateId,
      requestBody: { name, parents: [destFolderId] },
      fields: 'id',
    });
  }
}
```

- [ ] **Step 2: Share the Caregiver Applicants folder with your service account**

In Google Drive: right-click `Caregiver Applicants` → Share → paste service account email → Editor.

- [ ] **Step 3: Write `smoke/drive.smoke.ts`**

```typescript
import { DriveService } from '../src/adapters/drive.js';
import { loadConfig } from '../src/config.js';
import 'dotenv/config';

const config = loadConfig();
const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';
const drive = new DriveService(serviceAccountPath);

console.log('Creating test folder in Caregiver Applicants...');
const folderId = await drive.createFolder(
  'SMOKE_TEST_DELETE_ME',
  config.google_drive.recruiting_root_folder_id
);
console.log(`Created folder: https://drive.google.com/drive/folders/${folderId}`);

console.log('Uploading test file...');
await drive.uploadFile(folderId, 'test.txt', Buffer.from('smoke test'), 'text/plain');
console.log('Done. Delete the SMOKE_TEST_DELETE_ME folder from Drive.');
```

- [ ] **Step 4: Run smoke test manually**

```bash
node --loader ts-node/esm smoke/drive.smoke.ts
```

Expected: folder appears in Caregiver Applicants in Drive. Delete it after.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/drive.ts smoke/drive.smoke.ts
git commit -m "feat: Google Drive adapter"
```

---

## Task 14: Indeed Adapter (Playwright)

**Files:**
- Create: `src/adapters/indeed.ts`

Note: no automated test — Playwright against a live browser session cannot be safely automated in CI. Test manually after configuring credentials.

- [ ] **Step 1: Write `src/adapters/indeed.ts`**

```typescript
import { chromium, Browser, Page } from 'playwright';
import type { IndeedAdapter, Applicant, Interview } from '../types.js';

export class IndeedService implements IndeedAdapter {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(
    private email: string,
    private password: string,
  ) {}

  private async getPage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: false }); // headless:false to debug login
    const context = await this.browser.newContext();
    this.page = await context.newPage();
    await this.login();
    return this.page;
  }

  private async login(): Promise<void> {
    const page = this.page!;
    await page.goto('https://employers.indeed.com/p/login');
    await page.fill('input[name="email"]', this.email);
    await page.click('button[type="submit"]');
    await page.fill('input[name="password"]', this.password);
    await page.click('button[type="submit"]');
    // Wait for redirect to employer dashboard
    await page.waitForURL('**/employers.indeed.com/**', { timeout: 30_000 });
  }

  async getNewApplications(since: Date): Promise<Applicant[]> {
    const page = await this.getPage();
    await page.goto('https://employers.indeed.com/applicants');
    // TODO: Indeed's applicant list selectors — update if the page layout changes.
    // Selectors below are starting points; verify against the live page.
    await page.waitForSelector('[data-testid="applicant-list"]', { timeout: 15_000 });

    const applicants: Applicant[] = [];
    const items = await page.$$('[data-testid="applicant-list-item"]');

    for (const item of items) {
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
    await page.goto(`https://employers.indeed.com/applicants/${applicantId}/messages`);
    await page.waitForSelector('[data-testid="message-input"]');
    await page.fill('[data-testid="message-input"]', message);
    await page.click('[data-testid="send-message-button"]');
    await page.waitForSelector('[data-testid="message-sent-confirmation"]', { timeout: 10_000 });
  }

  async triggerScheduler(applicantId: string): Promise<void> {
    const page = await this.getPage();
    await page.goto(`https://employers.indeed.com/applicants/${applicantId}`);
    await page.waitForSelector('[data-testid="schedule-interview-button"]');
    await page.click('[data-testid="schedule-interview-button"]');
    // Indeed's scheduler flow — confirm the scheduling prompt
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
    await page.goto(`https://employers.indeed.com/applicants/${applicantId}`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-resume-button"]'),
    ]);
    const path = await download.path();
    const { readFile } = await import('fs/promises');
    return readFile(path!);
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}

function parseIndeedDate(text: string): Date {
  // Indeed shows dates like "2 days ago", "June 1", "5/31/2026" — parse accordingly
  const trimmed = text.trim();
  if (trimmed.includes('ago')) {
    const match = trimmed.match(/(\d+)\s+day/);
    if (match) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(match[1], 10));
      return d;
    }
  }
  return new Date(trimmed);
}
```

- [ ] **Step 2: Add Indeed credentials to `.env`**

```
INDEED_EMAIL=your@email.com
INDEED_PASSWORD=yourpassword
```

- [ ] **Step 3: Manual smoke test**

Run the agent entry point (Task 15) with `max_candidates_per_run: 1` and verify it logs into Indeed and reads one application. Do not send any messages yet — comment out `sendMessage` and `triggerScheduler` calls temporarily.

- [ ] **Step 4: Note on selectors**

The selectors in `indeed.ts` (e.g., `[data-testid="applicant-list"]`) are placeholders. Indeed's actual DOM must be inspected to find the real selectors. Open `https://employers.indeed.com/applicants` with Playwright in `headless: false` mode and use the browser's DevTools to find the correct selectors. Update the adapter before running live.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/indeed.ts
git commit -m "feat: Indeed Playwright adapter (selectors require live verification)"
```

---

## Task 15: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```typescript
import 'dotenv/config';
import { loadConfig } from './config.js';
import { readState, writeState } from './state.js';
import { screenApplicant } from './screening.js';
import { formatRunLog, getGitCommitHash } from './logger.js';
import { Agent } from './agent.js';
import { IndeedService } from './adapters/indeed.js';
import { SheetsService } from './adapters/sheets.js';
import { DriveService } from './adapters/drive.js';
import { SlackService } from './adapters/slack.js';

const config = loadConfig();

const slackToken = process.env.SLACK_BOT_TOKEN;
const indeedEmail = process.env.INDEED_EMAIL;
const indeedPassword = process.env.INDEED_PASSWORD;
const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json';

if (!slackToken) throw new Error('SLACK_BOT_TOKEN not set in .env');
if (!indeedEmail) throw new Error('INDEED_EMAIL not set in .env');
if (!indeedPassword) throw new Error('INDEED_PASSWORD not set in .env');

const indeed = new IndeedService(indeedEmail, indeedPassword);
const sheets = new SheetsService(serviceAccountPath, config.google_sheets.tracker_spreadsheet_id);
const drive = new DriveService(serviceAccountPath);
const slack = new SlackService(slackToken);

const state = readState();
const since = state?.lastRunAt ? new Date(state.lastRunAt) : new Date(0);

console.log(`Starting recruiter agent run. Checking applications since: ${since.toISOString()}`);

const agent = new Agent(indeed, sheets, drive, slack, screenApplicant, config);

const timeout = setTimeout(() => {
  console.error('Agent exceeded 30 minute timeout.');
  slack.post(config.slack.recruiting_channel, '⚠️ Recruiter agent timed out after 30 minutes. Manual check needed.')
    .finally(() => process.exit(1));
}, 30 * 60 * 1000);

try {
  const result = await agent.run(since);
  clearTimeout(timeout);

  const log = formatRunLog(result);
  console.log('\n' + log);

  writeState({ lastRunAt: result.startedAt.toISOString() });
  console.log(`\nRun complete. Processed ${result.newApplicantsReviewed} applicants.`);
} catch (err) {
  clearTimeout(timeout);
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal error:', message);
  await slack.post(config.slack.recruiting_channel, `🚨 Recruiter agent crashed: ${message}`).catch(() => {});
  process.exit(1);
} finally {
  await indeed.close();
}
```

- [ ] **Step 2: Run all tests one final time to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 3: Test the entry point with dry run**

Temporarily set `max_candidates_per_run: 0` in `config.yaml` and run:

```bash
node --loader ts-node/esm src/index.ts
```

Expected: agent starts, logs in to Indeed (browser window opens), finds 0 applicants to process (due to limit), completes, writes `state.json`.

- [ ] **Step 4: Restore `max_candidates_per_run: 1` and do a live test with one real candidate**

Verify:
- Correct intro message sent on Indeed
- Candidate appears in Google Sheets Active tab
- Slack posts when expected
- `state.json` is written

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI entry point with timeout and crash reporting"
```

---

## Running the Agent

```bash
# Install dependencies (first time only)
npm install
npx playwright install chromium

# Run the agent
node --loader ts-node/esm src/index.ts

# Run tests
npx vitest run
```
