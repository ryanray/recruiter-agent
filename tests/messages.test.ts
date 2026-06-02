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
