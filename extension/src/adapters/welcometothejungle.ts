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
 * REORDERING RULE (confirmed live by the user, precisely): viewing a job
 * moves it to the FRONT of the list, ahead of everything else — it doesn't
 * sink down or scatter randomly. So after viewing the cards originally at
 * positions 0, 1, 2, ..., the already-viewed ones always end up clustered
 * at the front, in the order they were viewed (most-recent first), pushing
 * everything not-yet-viewed down but preserving ITS relative order. The
 * practical consequence: position `currentIndex` (the same counter
 * `background.ts::runLoop` already tracks per page) always lands on a
 * not-yet-viewed job — no extra bookkeeping needed. An earlier version of
 * this file tried tracking visited jobIds in `sessionStorage` and scanning
 * for "first not visited" instead of trusting `index`, on the assumption
 * that the reordering was unpredictable; it wasn't, and direct indexing is
 * both correct here and simpler.
 *
 * The part that DID break in earlier versions: `countCardsExpr` misjudging
 * "how many cards are on this page" right after the `history.back()` above
 * — if it read a real-but-still-partial render (e.g. only 2-3 of 10 cards
 * re-rendered so far) as the *actual* page size, `currentIndex >= count`
 * would fire early and `runLoop` would click "next page" mid-page. Mitigated
 * by treating any suspiciously-low count as "still loading" (see
 * countCardsExpr) and by a generous `betweenCardsMs` giving the page time
 * to fully settle before the next card's count is even checked.
 *
 * A new tab per job (leaving the list tab untouched, sidestepping the
 * reordering entirely) was considered and rejected: only background.ts can
 * open tabs (`chrome.tabs.*`, not callable from a page-evaluated
 * expression), which would mean teaching background.ts and the
 * `SiteAdapter` contract a new "detail opens in a new tab" mode — this
 * project's adapters are meant to stay pure data, no `background.ts`
 * changes required to add one.
 *
 * `/en/jobs-matches` actually has two sections: "New matches" and "Seen
 * jobs" (a job moves from one to the other once viewed) — each with its
 * own near-identical pagination nav, differing only by a `seen-` testid
 * prefix. This adapter currently only paginates through "Seen jobs" (see
 * `nextPageRectExpr`); "New matches" pagination is an intentional
 * follow-up, not handled yet.
 *
 * Calibrated (Sep 2026) from: the list page (10 cards + pagination nav),
 * one job's detail page (Elastic / "Senior Software Engineer (SSC)"), and
 * live behavior reports from an actual run.
 */

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

// Cards are addressed by plain position (see file header for why that's
// safe here) — every use below is `(${ALL_CARDS_EXPR})[${index}]`.
function cardAt(index: number | string): string {
  return `(${ALL_CARDS_EXPR})[${index}]`;
}

export const welcomeToTheJungleAdapter: SiteAdapter = {
  id: 'welcometothejungle',
  label: 'Welcome to the Jungle',
  matches: (url) => /^https:\/\/www\.welcometothejungle\.com\/en\/jobs-matches/.test(url),

  // Generous relative to LinkedIn's: every card click is a full page
  // navigation (not an in-place panel update), and there's also the
  // return-to-list navigation between cards to absorb (see file header) —
  // betweenCardsMs in particular needs to comfortably outlast the list's
  // full re-render after history.back(), since countCardsExpr's only
  // defense against reading a still-loading partial render is treating an
  // implausibly low count as "not ready yet" (see below).
  timings: {
    afterClickMs: 1500,
    betweenCardsMs: 2500,
    scrollStepPx: 260,
    maxScrollAttempts: 12,
    maxDetailWaitAttempts: 8,
    maxPageLoadWaitAttempts: 8,
  },

  // The live card count, EXCEPT: a low-looking count is indistinguishable
  // from "the list is still re-rendering after history.back() and only
  // some cards have appeared so far" — reading that transient number as
  // the real page size is exactly what made runLoop click "next page"
  // mid-page in an earlier version. Since the page size observed while
  // calibrating this adapter never dropped below 10 except possibly on a
  // genuinely final results page, anything under 5 is treated as "still
  // loading" (a large sentinel, so runLoop keeps calling processCard
  // instead of jumping to pagination) rather than trusted as-is. A real
  // final page with fewer than 5 results would be misjudged the same way
  // and only resolved once cardRectExpr(index) starts returning null for
  // out-of-range indices (an 'empty' outcome, harmless — see processCard).
  countCardsExpr: `(() => {
    const count = ${ALL_CARDS_EXPR}.length;
    return count < 5 ? 999 : count;
  })()`,

  // Best-effort only, for the popup's "currently processing" indicator —
  // not authoritative (see extractExpr for why jobId there always wins).
  cardPreviewExpr: (index) => `(() => {
    const card = ${cardAt(index)};
    if (!card) return null;
    const titleLink = ${titleLinkExprFor('card')};
    if (!titleLink) return null;
    const hrefMatch = (titleLink.getAttribute('href') || '').match(/\\/jobs\\/([^/?#]+)/);
    return {
      jobId: hrefMatch ? hrefMatch[1] : '',
      title: titleLink.textContent.trim(),
      company: titleLink.parentElement?.querySelector('p')?.textContent?.trim() ?? '',
    };
  })()`,

  // Click the title link itself, not the card's outer wrapper — the
  // wrapper's "cursor-pointer" styling suggests a JS click handler on the
  // whole card, but clicking the real <a> guarantees an actual navigation
  // regardless of how that's wired up.
  cardRectExpr: (index) => rectExprFor(titleLinkExprFor(cardAt(index))),

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

    // Return to the list. jobUrl was captured above before this: location.href
    // reflects the new target as soon as a navigation is triggered, not the
    // page we're still extracting from.
    history.back();

    return { jobId, title, company, location: locationText, salary, url: jobUrl, text, workplaceType };
  })()`,

  // `www.welcometothejungle.com/en/jobs-matches` actually has two separate
  // sections, each with its own near-identical pagination nav (same CSS
  // classes, different data-testid prefix): "New matches"
  // (`job-list-pagination-arrow-next`) and "Seen jobs"
  // (`seen-job-list-pagination-arrow-next`) — jobs move from one to the
  // other as they're viewed. This adapter currently targets the "Seen"
  // section's pagination specifically, per the user: that's the one this
  // run is actually walking through today. "New matches" pagination is a
  // deliberately separate follow-up, not handled here yet.
  //
  // Confirmed disabled (not just hidden) at the start of "Seen jobs"
  // ("Previous Page" carries `disabled=""` on page 1) — assuming the same
  // convention applies to "Next Page" at the end, not yet confirmed live.
  nextPageRectExpr: rectExprFor(`document.querySelector('button[data-testid="seen-job-list-pagination-arrow-next"]:not([disabled])')`),
};
