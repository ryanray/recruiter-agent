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
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return parseScoreResponse(text);
  } catch (err) {
    console.error(`[Scorer] Failed to score ${applicant.name}: ${err instanceof Error ? err.message : err}`);
    return parseScoreResponse('');
  }
}
