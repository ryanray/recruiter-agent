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
