import type { JobResult } from '../adapters/types';

export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

export interface RunState {
  status: RunStatus;
  tabId: number | null;
  adapterId: string | null;
  currentIndex: number;
  /** Total cards found on the page currently being processed, or null before the first count. */
  currentPageCount: number | null;
  /** How many pages have finished processing (incremented on natural completion, not Stop). */
  pagesCompleted: number;
  results: JobResult[];
  error: string | null;
  updatedAt: string;
}

const KEY = 'runState';

function initialState(): RunState {
  return {
    status: 'idle',
    tabId: null,
    adapterId: null,
    currentIndex: 0,
    currentPageCount: null,
    pagesCompleted: 0,
    results: [],
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getState(): Promise<RunState> {
  const data = await chrome.storage.local.get(KEY);
  // Merge over defaults (not a plain fallback) so state persisted under an
  // older schema — missing fields added since — comes back fully populated
  // instead of leaving new fields undefined.
  return { ...initialState(), ...(data[KEY] as Partial<RunState> | undefined) };
}

export async function setState(patch: Partial<RunState>): Promise<RunState> {
  const current = await getState();
  const next: RunState = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function resetState(): Promise<RunState> {
  const fresh = initialState();
  await chrome.storage.local.set({ [KEY]: fresh });
  return fresh;
}

/** Persists a result immediately — so a Stop mid-run never loses anything. */
export async function appendResult(result: JobResult): Promise<RunState> {
  const current = await getState();
  return setState({ results: [...current.results, result] });
}
