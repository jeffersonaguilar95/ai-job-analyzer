export interface JobResult {
  index: number;
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
  /** Wait after the click, before reading the detail panel (to calibrate live). */
  afterClickMs: number;
  /** Wait between one card and the next. */
  betweenCardsMs: number;
  /** Magnitude of each scroll step (px equivalent of deltaY). */
  scrollStepPx: number;
  maxScrollAttempts: number;
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
  /** Expression that returns {x,y,top,bottom} for card N's center/bounds, or null. */
  cardRectExpr(index: number): string;
  /** Reference point (inside the list container) used to fire the scroll. */
  scrollContainerRectExpr: string;
  /** Expression that extracts {title, company, location, url, text} after clicking card N. */
  extractExpr(index: number): string;
}
