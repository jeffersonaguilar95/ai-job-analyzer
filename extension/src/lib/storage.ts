import type { JobResult } from '../adapters/types';

/**
 * 'batchLimitReached' means the page cap (see Settings) was hit with more
 * pages likely still available — distinct from 'done', which means the
 * adapter couldn't find a next page at all. Start uses this distinction to
 * decide whether to click to the next page before resuming.
 */
export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'batchLimitReached' | 'error';

/** A card recognized (by jobId) as already present in `results`, skipped without scoring it again. */
export interface DuplicateEntry {
  /** Monotonic counter shared with JobResult.seq — the true processing order. */
  seq: number;
  index: number;
  jobId: string;
  title: string;
  company: string;
  skippedAt: string;
}

/** The card currently mid-processing (scrolled/clicked, awaiting extraction+scoring), or null between cards. */
export interface CurrentJob {
  index: number;
  jobId: string;
  title: string;
  company: string;
}

export interface RunState {
  status: RunStatus;
  tabId: number | null;
  adapterId: string | null;
  currentIndex: number;
  /** Total cards found on the page currently being processed, or null before the first count. */
  currentPageCount: number | null;
  /** How many pages have finished processing (incremented on natural completion, not Stop). */
  pagesCompleted: number;
  currentJob: CurrentJob | null;
  /** Next value to assign to a JobResult/DuplicateEntry's `seq` — never reset except by Clear. */
  nextSeq: number;
  results: JobResult[];
  duplicates: DuplicateEntry[];
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
    currentJob: null,
    nextSeq: 0,
    results: [],
    duplicates: [],
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
export async function appendResult(result: Omit<JobResult, 'seq'>): Promise<RunState> {
  const current = await getState();
  const withSeq: JobResult = { ...result, seq: current.nextSeq };
  return setState({ results: [...current.results, withSeq], nextSeq: current.nextSeq + 1 });
}

export async function appendDuplicate(entry: Omit<DuplicateEntry, 'seq'>): Promise<RunState> {
  const current = await getState();
  const withSeq: DuplicateEntry = { ...entry, seq: current.nextSeq };
  return setState({ duplicates: [...current.duplicates, withSeq], nextSeq: current.nextSeq + 1 });
}

/**
 * Collapses down to one entry per jobId (keeping the earliest — i.e. lowest
 * `seq`). Shared by the "Remove duplicates" action (which persists the
 * result) and CSV/JSON export (which doesn't) — both should treat "no
 * duplicate jobIds" as a guarantee, not something the user has to remember
 * to trigger first.
 */
export function dedupeResults(results: JobResult[]): JobResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (r.jobId && seen.has(r.jobId)) return false;
    if (r.jobId) seen.add(r.jobId);
    return true;
  });
}

/**
 * User preferences — kept under a separate storage key from RunState so
 * Clear (which resets the run) doesn't also reset configuration.
 */
export interface Settings {
  /** How many pages of results one Start click processes before stopping (clicking Start again continues with the next batch). */
  maxPagesPerBatch: number;
}

const SETTINGS_KEY = 'settings';

function defaultSettings(): Settings {
  return { maxPagesPerBatch: 5 };
}

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...defaultSettings(), ...(data[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
