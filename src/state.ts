import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export interface State {
  lastRunAt: string;
  processedIds?: string[];
}

export function readState(statePath = 'state.json'): State | null {
  const path = resolve(statePath);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as State;
}

export function writeState(state: State, statePath = 'state.json'): void {
  writeFileSync(resolve(statePath), JSON.stringify(state, null, 2), 'utf8');
}

// Immediately persists a processed candidate ID so a crash mid-run doesn't re-process it.
export function markProcessed(id: string, statePath = 'state.json'): void {
  const current = readState(statePath) ?? { lastRunAt: new Date().toISOString() };
  const ids = new Set(current.processedIds ?? []);
  ids.add(id);
  writeState({ ...current, processedIds: [...ids] }, statePath);
}
