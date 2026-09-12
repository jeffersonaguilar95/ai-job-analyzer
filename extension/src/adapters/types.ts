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
  /** Expression that extracts {jobId, title, company, location, salary, url, text} after clicking card N. */
  extractExpr(index: number): string;
}
