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
 * To get back to the list for the next card, `extractExpr` itself calls
 * `history.back()` as its last step, once everything's already been read
 * off the detail page. Deliberately `history.back()`, not a hardcoded list
 * URL: if pagination turns out to encode the page number in the URL (e.g.
 * `?page=2`, unconfirmed either way), a hardcoded URL would always land
 * back on page 1 — silently losing pagination progress and forcing a full,
 * slow re-walk of page 1 (each "already scored" duplicate still costs a
 * real navigate-to-detail-and-back round trip here, unlike LinkedIn's
 * cheaper in-panel dedup check) for every single job processed beyond page
 * 1. `history.back()` has no such failure mode — it returns to whatever
 * the previous document in this tab's session history actually was.
 *
 * The user flagged (and it's confirmed) that the list's card order isn't
 * stable across reloads — going back doesn't reproduce the same order, and
 * may not even reproduce the same set of jobs. A new tab per job (leaving
 * the list tab untouched) would sidestep that entirely, but was rejected:
 * only the extension's own background.ts can open tabs (`chrome.tabs.*` —
 * not callable from a page-evaluated expression), so that would mean
 * teaching background.ts and the SiteAdapter contract a new "detail opens
 * in a new tab" mode, breaking the "adapters are just data, background.ts
 * never changes" rule this project holds to. Instead, this leans on
 * dedup-by-`jobId` that `background.ts::processCard` already does for
 * every adapter: reprocessing the same job at a different index after a
 * reshuffle is recognized and skipped, not re-scored. The only real
 * failure mode is a job rarely being missed entirely within one page's
 * pass if the reshuffle is adversarial enough — safe to just re-run the
 * extension afterward, since anything already scored is skipped, not
 * redone.
 *
 * Calibrated (Sep 2026) from: the list page (10 cards + pagination nav)
 * and one job's detail page (Elastic / "Senior Software Engineer (SSC)").
 * Not yet run live end-to-end.
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

  // While mid-navigation back from a detail page (see extractExpr), the
  // list hasn't re-rendered yet and this would otherwise read 0 — which
  // runLoop would misread as "reached the end of this page" and jump
  // straight to pagination. Falling back to a placeholder (the page size
  // observed while calibrating) keeps the loop retrying via
  // scrollUntilVisible's own poll/backoff instead; once the list actually
  // reloads, the next iteration reads the real count again. Worst case if
  // the guess is off: one wasted retry cycle for an index that turns out
  // not to exist, not a correctness bug (see processCard's 'empty' case).
  countCardsExpr: `(() => {
    const cards = ${ALL_CARDS_EXPR};
    return cards.length > 0 ? cards.length : 10;
  })()`,

  // Best-effort only — jobId here is parsed straight from the card's own
  // href (not location.href, since we haven't navigated yet), which is the
  // same slug extractExpr will read off the detail page's URL after the
  // click. Matches LinkedIn's pattern of the preview being cheap/advisory,
  // not the authoritative dedup check (that happens in processCard, off
  // extractExpr's result).
  cardPreviewExpr: (index) => `(() => {
    const card = (${ALL_CARDS_EXPR})[${index}];
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
  cardRectExpr: (index) => rectExprFor(titleLinkExprFor(`(${ALL_CARDS_EXPR})[${index}]`)),

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
  // stable `id`, unlike the swipe adapter's old build-hashed-class
  // situation) — covers both "Job description" and "Preferred experience"
  // (plus any benefits list inside the description), without pulling in
  // unrelated page chrome (apply button, share menu, FAQ accordion).
  //
  // workplaceType: only "Fully-remote" has been observed in samples so
  // far — the hybrid/onsite keyword branches are an unverified guess by
  // analogy with the other adapters, not confirmed against a real
  // non-remote posting on this site.
  extractExpr: (_index) => `(() => {
    // By this point we've already navigated off the list to the job's own
    // detail page (see cardRectExpr/detailReadyExpr) — there's no "does
    // card N still exist" check to make here the way list-page adapters
    // do, since this runs against a different page entirely.
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

    // Return to the list (whatever pagination state it was on — see file
    // header for why this is history.back() and not a hardcoded URL) so
    // the next index in this run can be located. jobUrl was captured above
    // before this: location.href reflects the new target as soon as a
    // navigation is triggered, not the page we're still extracting from.
    history.back();

    return { jobId, title, company, location: locationText, salary, url: jobUrl, text, workplaceType };
  })()`,

  // Confirmed disabled (not just hidden) at the start of the list ("Previous
  // Page" carries `disabled=""` on page 1) — assuming the same convention
  // applies to "Next Page" at the end, not yet confirmed live.
  nextPageRectExpr: rectExprFor(`document.querySelector('button[data-testid="job-list-pagination-arrow-next"]:not([disabled])')`),
};
