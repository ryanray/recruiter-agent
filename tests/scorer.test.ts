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
