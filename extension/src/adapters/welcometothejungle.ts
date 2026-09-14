import type { SiteAdapter } from './types';
import { rectExprFor } from './shared';

/**
 * Targets `www.welcometothejungle.com/en/jobs-matches` — the site's own
 * job-search grid (numbered `job-card-N` cards + a real "next page" button).
 * This REPLACES an earlier version of this file that targeted
 * `app.welcometothejungle.com`, a completely different product (Otta's
 * "one job at a time" swipe UI, under a different codebase — same company,
 * unrelated frontend). The user redirected to this one; the swipe adapter
 * is gone, not just superseded.
 *
 * Unlike LinkedIn's in-page detail panel, clicking a card here is a real,
 * full navigation (same tab) to `/en/companies/<company>/jobs/<slug>` — a
 * completely separate page with its own DOM, not a panel next to the list.
 * To get back to the list for the next card, `extractExpr` calls
 * `history.back()` as its last step, once everything's already been read
 * off the detail page.
 *
 * CONFIRMED LIVE (not just a theoretical risk): the list actively re-sorts
 * by seen/not-seen as you visit jobs — going back doesn't just reshuffle
 * cosmetically, it reorganizes hard enough that "index N" never means the
 * same card twice in a row. Treating index as a stable position (the first
 * version of this file did) broke badly: `countCardsExpr`/`currentIndex`
 * desynced from the live list, `runLoop` misread a post-back reload as
 * having reached a new page, and pagination fired at the wrong times.
 *
 * Fix: this version never uses the `index` argument at all (every
 * `(_index)` param below is intentionally unused). Instead, each already
 * visited job is recorded by jobId in `sessionStorage` (same-origin, so it
 * survives both `history.back()` and pagination clicks within this tab),
 * and `cardRectExpr`/`cardPreviewExpr`/`countCardsExpr` all work off "is
 * there a not-yet-visited card visible right now", scanning the live DOM
 * fresh every time rather than trusting a position. This also means an
 * already-visited card is never clicked into in the first place, avoiding
 * the slow full navigate-there-and-back round trip that re-checking
 * duplicates via `background.ts`'s own jobId dedup would otherwise cost on
 * every single re-shuffle. That dedup (based on already-scored results,
 * not this sessionStorage set) remains the authoritative backstop — this
 * is purely a "don't bother clicking this one again" optimization.
 *
 * A new tab per job (leaving the list tab untouched, sidestepping the
 * reshuffling entirely) was considered and rejected: only background.ts
 * can open tabs (`chrome.tabs.*`, not callable from a page-evaluated
 * expression), which would mean teaching background.ts and the
 * `SiteAdapter` contract a new "detail opens in a new tab" mode — this
 * project's adapters are meant to stay pure data, no `background.ts`
 * changes required to add one.
 *
 * Calibrated (Sep 2026) from: the list page (10 cards + pagination nav)
 * and one job's detail page (Elastic / "Senior Software Engineer (SSC)"),
 * plus live behavior reports from an actual run. Not yet fully verified
 * end-to-end (particularly: whether the "next page" button ever actually
 * gets reached/disabled, given the list can keep resurfacing new unseen
 * jobs on page 1 rather than requiring pagination at all).
 */

const VISITED_KEY = 'aiJobAnalyzerWtjVisitedJobs';

// A plain `[data-testid^="job-card-"]` selector would also match the inner
// tag pills (`job-card-tag-remote`, `job-card-tag-salary`, ...), which share
// that same prefix — filtered by regex instead to match only the numbered
// card containers (`job-card-1`, `job-card-2`, ...).
const ALL_CARDS_EXPR = `[...document.querySelectorAll('[data-testid]')].filter((el) => /^job-card-\\d+$/.test(el.getAttribute('data-testid')))`;

// A card's title link doubles as the one reliable way to find it: the
// company logo's own link (`/en/companies/<slug>`, no `/jobs/`) sits right
// next to it, so scoping to `href*="/jobs/"` picks the title specifically.
function titleLinkExprFor(cardExpr: string): string {
  return `(${cardExpr})?.querySelector('a[href*="/jobs/"]')`;
}

// jobId parsed from a card's own href (list page, pre-click) — same slug
// extractExpr reads from location.href on the detail page after the click,
// so a job marked visited there is recognized here without ever navigating.
function cardJobIdExprFor(cardExpr: string): string {
  return `(() => {
    const href = (${titleLinkExprFor(cardExpr)})?.getAttribute('href') || '';
    const m = href.match(/\\/jobs\\/([^/?#]+)/);
    return m ? m[1] : '';
  })()`;
}

const VISITED_SET_EXPR = `new Set(JSON.parse(sessionStorage.getItem('${VISITED_KEY}') || '[]'))`;

// The one thing every other expression below builds on: scans the live
// list fresh (never trusts a remembered position) and returns the first
// card whose jobId isn't in the visited set, or undefined if none.
const FIRST_UNVISITED_CARD_EXPR = `(() => {
  const visited = ${VISITED_SET_EXPR};
  return ${ALL_CARDS_EXPR}.find((card) => !visited.has(${cardJobIdExprFor('card')}));
})()`;

export const welcomeToTheJungleAdapter: SiteAdapter = {
  id: 'welcometothejungle',
  label: 'Welcome to the Jungle',
  matches: (url) => /^https:\/\/www\.welcometothejungle\.com\/en\/jobs-matches/.test(url),

  // Generous relative to LinkedIn's: every card click is a full page
  // navigation (not an in-place panel update), and there's also the
  // return-to-list navigation between cards to absorb (see file header).
  timings: {
    afterClickMs: 1500,
    betweenCardsMs: 1800,
    scrollStepPx: 260,
    maxScrollAttempts: 12,
    maxDetailWaitAttempts: 8,
    maxPageLoadWaitAttempts: 8,
  },

  // Deliberately not "the live card count" (see file header — index/count
  // matching a reordering list is exactly what broke). Two states only:
  // 0 cards rendered at all (still loading after a back-navigation) or a
  // pagination boundary reports 0 too, since neither has an unvisited card
  // to give cardRectExpr; any unvisited card present anywhere reports a
  // large sentinel so runLoop keeps calling processCard instead of jumping
  // to pagination. currentIndex itself is irrelevant here — nothing below
  // reads it — so this only needs to stay above whatever currentIndex has
  // counted up to so far this page.
  countCardsExpr: `(${FIRST_UNVISITED_CARD_EXPR} ? 9999 : 0)`,

  // Ignores `index` — always previews whichever card would actually get
  // clicked next (see FIRST_UNVISITED_CARD_EXPR), so the popup's "currently
  // processing" indicator reflects reality instead of a stale position.
  cardPreviewExpr: (_index) => `(() => {
    const card = ${FIRST_UNVISITED_CARD_EXPR};
    if (!card) return null;
    const titleLink = ${titleLinkExprFor('card')};
    if (!titleLink) return null;
    return {
      jobId: ${cardJobIdExprFor('card')},
      title: titleLink.textContent.trim(),
      company: titleLink.parentElement?.querySelector('p')?.textContent?.trim() ?? '',
    };
  })()`,

  // Click the title link itself, not the card's outer wrapper — the
  // wrapper's "cursor-pointer" styling suggests a JS click handler on the
  // whole card, but clicking the real <a> guarantees an actual navigation
  // regardless of how that's wired up. Ignores `index`, same reasoning as
  // countCardsExpr/cardPreviewExpr.
  cardRectExpr: (_index) => rectExprFor(titleLinkExprFor(FIRST_UNVISITED_CARD_EXPR)),

  // Plain page, no dedicated scrollable list container observed — falls
  // back to scrollUntilVisible's own default click point.
  scrollContainerRectExpr: 'null',

  // By this point we've navigated clean off the list to the job's own
  // detail page. Ready once the position section (job description +
  // preferred experience) has rendered with real text.
  detailReadyExpr: `(() => {
    const el = document.getElementById('the-position-section');
    return !!(el && el.innerText && el.innerText.trim().length > 0);
  })()`,

  // Title/company/location/salary/workplace all live in
  // [data-testid="job-metadata-block"] on the detail page; none of the tag
  // rows (location/salary/remote) have their own data-testid, so they're
  // found via their icon's `alt` attribute instead (e.g. `svg[alt="Salary"]`)
  // and read off that icon's parent row.
  //
  // `text` is the `#the-position-section` block specifically (a real,
  // stable `id`) — covers both "Job description" and "Preferred experience"
  // (plus any benefits list inside the description), without pulling in
  // unrelated page chrome (apply button, share menu, FAQ accordion).
  //
  // workplaceType: only "Fully-remote" has been observed in samples so
  // far — the hybrid/onsite keyword branches are an unverified guess by
  // analogy with the other adapters, not confirmed against a real
  // non-remote posting on this site.
  //
  // Also ignores `index` (see file header) — this runs against whatever
  // job cardRectExpr's click just navigated to, identified entirely by
  // location.href, not by any position.
  extractExpr: (_index) => `(() => {
    const jobUrl = location.href;
    const jobIdMatch = jobUrl.match(/\\/jobs\\/([^/?#]+)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : '';

    const metaBlock = document.querySelector('[data-testid="job-metadata-block"]');
    const title = metaBlock?.querySelector('h2')?.textContent?.trim() ?? '';
    const company = metaBlock?.querySelector('a[href^="/en/companies/"] span')?.textContent?.trim() ?? '';

    const tagRowText = (iconAlt) => {
      const svg = metaBlock?.querySelector('svg[alt="' + iconAlt + '"]');
      return svg?.parentElement?.textContent?.trim() ?? '';
    };
    const locationText = tagRowText('Location');
    const salary = tagRowText('Salary');
    const remoteTagText = tagRowText('Remote').toLowerCase();
    const workplaceType = remoteTagText.includes('remote')
      ? 'remote'
      : remoteTagText.includes('hybrid')
        ? 'hybrid'
        : remoteTagText.includes('onsite') || remoteTagText.includes('on-site')
          ? 'onsite'
          : 'unknown';

    const text = document.getElementById('the-position-section')?.innerText?.trim() ?? '';

    // Record this jobId as visited (sessionStorage, same-origin — survives
    // the history.back() below and any later pagination click) so the list
    // page's FIRST_UNVISITED_CARD_EXPR skips it from now on, regardless of
    // where the reordering puts it.
    if (jobId) {
      const visited = JSON.parse(sessionStorage.getItem('${VISITED_KEY}') || '[]');
      if (!visited.includes(jobId)) {
        visited.push(jobId);
        sessionStorage.setItem('${VISITED_KEY}', JSON.stringify(visited));
      }
    }

    // Return to the list. jobUrl was captured above before this: location.href
    // reflects the new target as soon as a navigation is triggered, not the
    // page we're still extracting from.
    history.back();

    return { jobId, title, company, location: locationText, salary, url: jobUrl, text, workplaceType };
  })()`,

  // Confirmed disabled (not just hidden) at the start of the list ("Previous
  // Page" carries `disabled=""` on page 1) — assuming the same convention
  // applies to "Next Page" at the end, not yet confirmed live. Note this
  // may rarely get reached at all if the list keeps resurfacing unseen jobs
  // on page 1 instead of requiring pagination — that's fine, it just means
  // countCardsExpr keeps reporting work to do.
  nextPageRectExpr: rectExprFor(`document.querySelector('button[data-testid="job-list-pagination-arrow-next"]:not([disabled])')`),
};
