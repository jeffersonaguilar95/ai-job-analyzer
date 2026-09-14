import type { SiteAdapter } from './types';
import { rectExprFor } from './shared';

/**
 * Welcome to the Jungle's job search isn't a list of cards like LinkedIn —
 * it's a "one job at a time" swipe view (Otta under the hood: CDN
 * images.otta.com, an "Our take" company blurb) with a `next-button`
 * advancing to the next job in the queue. That maps cleanly onto this
 * project's page/card model without touching background.ts: each job is
 * treated as a "page" with exactly one card (`countCardsExpr` is always 0 or
 * 1), and the "next job" button plays the role of `nextPageRectExpr`.
 *
 * Calibrated from pasted samples (Sep 2026): one job page (/jobs/rDS-sovw)
 * and the end-of-queue interstitial. Confirmed: at the end of the queue,
 * `next-button` doesn't disable or disappear — clicking it on the last job
 * navigates to a "Great progress! You've seen another set of matches"
 * screen with a "See more jobs" button instead of another job. That screen
 * has neither `[data-testid="job-card-main"]` nor
 * `button[data-testid="next-button"]`, so `countCardsExpr` and
 * `nextPageRectExpr` both naturally resolve to "nothing here" once on it —
 * `runLoop`/`goToNextPage` already treat that as "no next page" and stop
 * cleanly (`status: 'done'`), no special-casing needed. "See more jobs" is
 * deliberately not clicked — reaching this screen is the intended stopping
 * point, not something to page past.
 */

const JOB_CARD_EXPR = `document.querySelector('[data-testid="job-card-main"]')`;

const JOB_ID_EXPR = `(location.href.match(/\\/jobs\\/([^/?#]+)/) || [])[1] || ''`;

// The company name is embedded as a nested <a> inside the title heading
// ("Senior Software Engineer, <a>RevenueCat</a>"), so the title itself is
// read by cloning the heading and stripping any <a> before taking its text
// (then trimming the now-dangling trailing comma). Company comes from the
// logo's alt text instead of parsing it out of the title/link.
const TITLE_COMPANY_EXPR = `(() => {
  const titleEl = document.querySelector('[data-testid="job-title"]');
  let title = '';
  if (titleEl) {
    const clone = titleEl.cloneNode(true);
    clone.querySelectorAll('a').forEach((a) => a.remove());
    title = clone.innerText.trim().replace(/,\\s*$/, '');
  }
  const company = document.querySelector('[data-testid="company-logo"] img')?.alt?.trim() ?? '';
  return { title, company };
})()`;

// Named `locationText`, not `location` — this file also reads the page's
// own `location.href` for the job id/url, and a local `const location`
// would shadow that global for the rest of the enclosing function.
const LOCATION_EXPR = `(document.querySelector('[data-testid="job-locations"]')?.innerText?.trim() ?? '')`;

// No parenthetical convention like LinkedIn's here — workplace type is
// inferred from keywords in the same location text instead (e.g. "Remote
// from Europe, Canada, UK, US"). UNVERIFIED against a real hybrid/onsite
// posting on this site; 'unknown' still goes through normal LLM scoring
// rather than being discarded (see WorkplaceType).
function workplaceTypeExprFor(locationExpr: string): string {
  return `(() => {
    const loc = (${locationExpr}).toLowerCase();
    if (loc.includes('remote')) return 'remote';
    if (loc.includes('hybrid')) return 'hybrid';
    if (loc.includes('onsite') || loc.includes('on-site')) return 'onsite';
    return 'unknown';
  })()`;
}

export const welcomeToTheJungleAdapter: SiteAdapter = {
  id: 'welcometothejungle',
  label: 'Welcome to the Jungle',
  matches: (url) => /^https:\/\/app\.welcometothejungle\.com\/jobs\//.test(url),

  timings: {
    afterClickMs: 1200,
    betweenCardsMs: 500,
    scrollStepPx: 260,
    maxScrollAttempts: 10,
    maxDetailWaitAttempts: 6,
    maxPageLoadWaitAttempts: 8,
  },

  // Only ever one job on screen at a time (see file header) — 1 while it's
  // there, 0 if the page hasn't loaded one (or the queue ran out).
  countCardsExpr: `(${JOB_CARD_EXPR} ? 1 : 0)`,

  cardPreviewExpr: (index) => `(() => {
    if (${index} !== 0 || !${JOB_CARD_EXPR}) return null;
    const jobId = ${JOB_ID_EXPR};
    const { title, company } = ${TITLE_COMPANY_EXPR};
    return { jobId, title, company };
  })()`,

  // The whole job is already rendered without needing a click, so the click
  // background.ts always fires before extracting just needs to land
  // somewhere inert. job-subtitle (the team name, e.g. "Product") is plain
  // text with no nested <a> — unlike job-title, which links to the company
  // site (target="_blank") and would spawn a new tab if clicked.
  cardRectExpr: (index) =>
    rectExprFor(`(${index} === 0 ? document.querySelector('[data-testid="job-subtitle"]') : null)`),

  // No dedicated scrollable list container — the job is already in view on
  // load, so falling back to scrollUntilVisible's own default click point is
  // fine.
  scrollContainerRectExpr: 'null',

  // Nothing to wait for (no panel loads after the click) — ready as soon as
  // the job content itself has text.
  detailReadyExpr: `(() => {
    const el = ${JOB_CARD_EXPR};
    return !!(el && el.innerText && el.innerText.trim().length > 0);
  })()`,

  // `text` is the entire job-card-main block, not just the "Role" section
  // (Who you are / What the job involves / Application process) — there's
  // no data-testid scoping just that part, and the class that wraps it is a
  // build-hashed styled-components class reused by the company-benefits
  // section too, so isolating it would be fragile. Including the
  // company/funding/benefits text alongside the role is harmless extra
  // context for the LLM, not noise.
  //
  // `jobId`/`url` come straight from location.href (`/jobs/<slug>`) — unlike
  // LinkedIn's SPA panel, this site's address bar genuinely updates per job
  // as you advance through the queue.
  extractExpr: (index) => `(() => {
    if (${index} !== 0 || !${JOB_CARD_EXPR}) {
      return { jobId: '', title: '', company: '', location: '', salary: '', url: location.href, text: '', workplaceType: 'unknown' };
    }
    const jobId = ${JOB_ID_EXPR};
    const { title, company } = ${TITLE_COMPANY_EXPR};
    const locationText = ${LOCATION_EXPR};
    const workplaceType = ${workplaceTypeExprFor('locationText')};
    const salary = document.querySelector('[data-testid="salary-section"]')?.innerText?.trim() ?? '';
    const text = ${JOB_CARD_EXPR}?.innerText?.trim() ?? '';
    return { jobId, title, company, location: locationText, salary, url: location.href, text, workplaceType };
  })()`,

  // Confirmed absent (not just hidden/disabled) on the end-of-queue
  // interstitial (see file header) — resolves to null there, which is what
  // makes goToNextPage stop the run cleanly.
  nextPageRectExpr: rectExprFor(`document.querySelector('button[data-testid="next-button"]:not([disabled])')`),
};
