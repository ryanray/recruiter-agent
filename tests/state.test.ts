import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { readState, writeState, markProcessed } from '../src/state.js';

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

  it('markProcessed persists an id and accumulates across calls', () => {
    writeState({ lastRunAt: new Date().toISOString() }, TEST_STATE_PATH);
    markProcessed('abc123', TEST_STATE_PATH);
    markProcessed('def456', TEST_STATE_PATH);
    const state = readState(TEST_STATE_PATH);
    expect(state?.processedIds).toContain('abc123');
    expect(state?.processedIds).toContain('def456');
    expect(state?.processedIds).toHaveLength(2);
  });

  it('markProcessed creates state file if it does not exist', () => {
    markProcessed('xyz789', TEST_STATE_PATH);
    const state = readState(TEST_STATE_PATH);
    expect(state?.processedIds).toContain('xyz789');
  });
});
