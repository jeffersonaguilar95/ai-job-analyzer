/**
 * 'unknown' means the adapter couldn't tell — those still go through the
 * normal LLM scoring path rather than being discarded, so an unrecognized
 * DOM shape never silently drops a posting that might actually be remote.
 */
export type WorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'unknown';

/** The user-configured workplace-type filter (Settings). 'any' disables filtering entirely — nothing is ever discarded on workplace type. */
export type WorkplacePreference = 'remote' | 'hybrid' | 'onsite' | 'any';

export interface JobResult {
  /** Monotonic counter assigned on append (shared with DuplicateEntry) — the true processing order, unlike `index`, which resets per page. */
  seq: number;
  index: number;
  jobId: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  url: string;
  text: string;
  workplaceType: WorkplaceType;
  /** True when this entry was never sent to the LLM — score is forced to 0 (not null) so it's distinguishable from a matching-service failure. */
  discarded: boolean;
  score: number | null;
  strengths: string[];
  gaps: string[];
  reasoning: string | null;
  scoredAt: string | null;
}

export interface AdapterTimings {
  /** Poll interval while waiting for the detail panel to render after a click (see maxDetailWaitAttempts). */
  afterClickMs: number;
  /** Wait between one card and the next. */
  betweenCardsMs: number;
  /** Magnitude of each scroll step (px equivalent of deltaY). */
  scrollStepPx: number;
  maxScrollAttempts: number;
  /** Max polls (every afterClickMs) for the detail panel to be ready before extracting anyway. */
  maxDetailWaitAttempts: number;
  /** Max polls (every afterClickMs) for the next results page to have loaded cards after clicking to it. */
  maxPageLoadWaitAttempts: number;
}

/**
 * An adapter translates the "what" (count cards, locate one, extract text)
 * into JS expressions evaluated on the page via Runtime.evaluate. Adding a
 * new job board = writing a new adapter, without touching the loop in
 * background.ts.
 */
export interface SiteAdapter {
  id: string;
  label: string;
  matches(url: string): boolean;
  timings: AdapterTimings;
  /** Expression that returns the number of result cards visible in the DOM. */
  countCardsExpr: string;
  /** Expression that returns {jobId, title, company} for card N, or null — read without scrolling/clicking, so already-scored cards can be identified (and shown as "processing"/"duplicate") cheaply. */
  cardPreviewExpr(index: number): string;
  /** Expression that returns {x,y,top,bottom} for card N's center/bounds, or null. */
  cardRectExpr(index: number): string;
  /** Reference point (inside the list container) used to fire the scroll. */
  scrollContainerRectExpr: string;
  /** Expression that returns true once the detail panel has finished rendering for the just-clicked card (polled after the click, before extractExpr). */
  detailReadyExpr: string;
  /** Expression that extracts {jobId, title, company, location, salary, url, text, workplaceType} after clicking card N. */
  extractExpr(index: number): string;
  /** Expression that returns {x,y} for the "next page" control, or null if there isn't one (last page of results). */
  nextPageRectExpr: string;
}
