import type { SiteAdapter } from './types';
import { rectExprFor } from './shared';

/**
 * Selectors calibrated live against linkedin.com/jobs/collections (Sep 2026).
 * LinkedIn's list-card CSS classes are build-hashed and rotate across
 * deploys (e.g. `_4ad3fe9f`, `fe4f64b5`), so these avoid classes in favor of
 * the one stable structural marker found on cards: the `componentkey`
 * attribute. Still expect to recalibrate as LinkedIn ships changes — see
 * README roadmap. `DESCRIPTION_SELECTOR`/`text` extraction from the detail
 * panel is not yet calibrated (left empty) — needs a live sample of that
 * panel's DOM.
 */
const CARD_SELECTOR = 'div[role="button"][componentkey^="job-card-component-ref-"]';

function jobIdExprFor(cardExpr: string): string {
  return `(${cardExpr}?.getAttribute('componentkey') || '').replace('job-card-component-ref-', '')`;
}

// Title/company/location live on the card itself (no dependency on the
// detail panel's DOM). The title paragraph is the only one with a nested
// `span[aria-hidden]` before the card's footer metadata, so it's found by
// that; company/location are the next two plain paragraphs in DOM order.
// Shared by extractExpr (after the click) and cardPreviewExpr (before it),
// so both stay in sync if this needs recalibrating.
function titleCompanyLocationExprFor(cardExpr: string): string {
  // Uses `el`, not `card` — callers pass an already-declared `card` variable
  // as cardExpr, and this runs as its own IIFE, so naming the local the same
  // would shadow it with a `const el = el`-style TDZ error.
  return `(() => {
    const el = ${cardExpr};
    const paragraphs = [...el.querySelectorAll('p')];
    const titleSpan = el.querySelector('p span[aria-hidden="true"]');
    const title = titleSpan ? titleSpan.textContent.trim() : (paragraphs[0]?.innerText.trim() ?? '');
    const company = paragraphs[1] ? paragraphs[1].innerText.trim() : '';
    const location = paragraphs[2] ? paragraphs[2].innerText.trim() : '';
    return { title, company, location };
  })()`;
}

// LinkedIn appends the workplace type to the location string shown on the
// card itself, e.g. "Bogotá, Colombia (Remote)" / "(Hybrid)" / "(On-site)" —
// there's no separate element for it, so it's read off the same `location`
// text titleCompanyLocationExprFor already extracts. UNVERIFIED against a
// live on-site/hybrid posting; if this comes back 'unknown' for postings you
// know aren't remote, recalibrate against the real parenthetical text.
// 'unknown' deliberately still goes through normal LLM scoring (see
// WorkplaceType) rather than being discarded, so a DOM change never
// silently drops postings that might actually be remote.
function workplaceTypeExprFor(locationExpr: string): string {
  return `(() => {
    const match = (${locationExpr}).match(/\\(([^)]+)\\)\\s*$/);
    const tag = match ? match[1].trim().toLowerCase() : '';
    if (tag === 'remote') return 'remote';
    if (tag === 'hybrid') return 'hybrid';
    if (tag === 'on-site' || tag === 'onsite') return 'onsite';
    return 'unknown';
  })()`;
}

// The last SemanticJobDetails screen in the DOM — there may be stale ones
// left over from earlier cards, so "last" (not "only") is what identifies
// the one for the card just clicked.
const PANEL_EXPR = `(() => {
  const panels = document.querySelectorAll('[data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"]');
  return panels[panels.length - 1] ?? null;
})()`;

export const linkedinAdapter: SiteAdapter = {
  id: 'linkedin',
  label: 'LinkedIn',
  matches: (url) => /^https:\/\/(www\.)?linkedin\.com\/jobs\//.test(url),

  timings: {
    afterClickMs: 1200,
    betweenCardsMs: 400,
    scrollStepPx: 260,
    maxScrollAttempts: 10,
    maxDetailWaitAttempts: 6,
    maxPageLoadWaitAttempts: 8,
  },

  countCardsExpr: `document.querySelectorAll('${CARD_SELECTOR}').length`,

  // Read straight off the card, without scrolling/clicking, so already-seen
  // postings can be identified (and shown as "processing" or "duplicate")
  // before paying for a scroll+click+LLM call.
  cardPreviewExpr: (index) => `(() => {
    const card = document.querySelectorAll('${CARD_SELECTOR}')[${index}];
    if (!card) return null;
    const jobId = ${jobIdExprFor('card')};
    const { title, company } = ${titleCompanyLocationExprFor('card')};
    return { jobId, title, company };
  })()`,

  cardRectExpr: (index) => rectExprFor(`document.querySelectorAll('${CARD_SELECTOR}')[${index}]`),

  // No stable selector for the scrollable list container itself: walk up
  // from the first card to the nearest scrollable ancestor instead.
  scrollContainerRectExpr: `(() => {
    const card = document.querySelector('${CARD_SELECTOR}');
    if (!card) return null;
    let el = card.parentElement;
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`,

  // Rendering the detail panel isn't instant and varies with how heavy the
  // posting/network is — waiting a fixed delay before extractExpr meant
  // some cards got read before their panel (and thus jobId/url/text/salary)
  // existed at all, silently producing empty fields. Polled instead: ready
  // once BOTH the title link (jobId/url) and the "About the job" description
  // are there — the two loaded independently and a card could pass the
  // title-only check while the description was still empty, sending an
  // empty `text` to matching-service (which 400s "text is required" with no
  // server-side error to log, so it looked like the service was just down).
  detailReadyExpr: `(() => {
    const panel = ${PANEL_EXPR};
    if (!panel) return false;
    const hasTitle = !!panel.querySelector('a[href*="/jobs/view/"]');
    const aboutJob = panel.querySelector('[id^="JobDetails_AboutTheJob_"]');
    const hasDescription = !!(aboutJob && aboutJob.querySelector('span[data-testid="expandable-text-box"]'));
    return hasTitle && hasDescription;
  })()`,

  // Title/company/location live on the card itself, so they're read straight
  // from it (no dependency on the detail panel's DOM). The title paragraph
  // is the only one with a nested `span[aria-hidden]` before the card's
  // footer metadata, so it's found by that; company/location are the next
  // two plain paragraphs in DOM order.
  //
  // The canonical URL/ID come from the detail panel's own title link, not
  // the card's `componentkey` — see the comment further down where it's
  // read, next to the dedup-breaking case that ruled componentkey out.
  //
  // The full description comes from the detail panel that opens after the
  // click, scoped to the last `SemanticJobDetails` screen (there may be
  // stale ones left in the DOM from earlier cards) so it doesn't cross into
  // the sibling "About the company" section, which has its own
  // `expandable-text-box`.
  //
  // Salary (when published) is read from the detail panel's row of "job
  // criteria" pills (the same row as "Remote"/"Full-time"): each pill is an
  // anchor pointing to /jobs/search-results/?currentJobId=..., and one of
  // them holds the pay range when the poster included it. Matched by
  // currency/period pattern rather than position, since the pill only
  // appears at all when a salary was published — UNVERIFIED against a real
  // posting with salary listed; recalibrate against one if it comes back
  // empty on a posting you know lists a range.
  extractExpr: (index) => `(() => {
    const card = document.querySelectorAll('${CARD_SELECTOR}')[${index}];
    if (!card) return { jobId: '', title: '', company: '', location: '', salary: '', url: location.href, text: '', workplaceType: 'unknown' };
    const { title, company, location } = ${titleCompanyLocationExprFor('card')};
    const workplaceType = ${workplaceTypeExprFor('location')};

    const panel = ${PANEL_EXPR};

    // Authoritative ID: parsed from the detail panel's own title link
    // (/jobs/view/<id>/), not the card's componentkey — that's a UI
    // component-instance ref, not necessarily the same for two list entries
    // that are actually the same posting (e.g. a promoted repost), which
    // broke duplicate detection. Falls back to componentkey only if the
    // panel/link isn't there for some reason.
    const titleLink = panel ? panel.querySelector('a[href*="/jobs/view/"]') : null;
    const urlMatch = titleLink ? titleLink.href.match(/\\/jobs\\/view\\/(\\d+)/) : null;
    const jobId = urlMatch ? urlMatch[1] : ${jobIdExprFor('card')};
    const url = jobId ? \`https://www.linkedin.com/jobs/view/\${jobId}/\` : (titleLink ? titleLink.href : location.href);

    const aboutJob = panel ? panel.querySelector('[id^="JobDetails_AboutTheJob_"]') : null;
    const descEl = aboutJob ? aboutJob.querySelector('span[data-testid="expandable-text-box"]') : null;
    const text = descEl ? descEl.innerText.trim() : '';

    const pillTexts = panel
      ? [...panel.querySelectorAll('a[href*="/jobs/search-results/"] span')].map((el) => el.textContent.trim())
      : [];
    const salary = pillTexts.find((t) => /[$€£]|\\/yr|\\/hr|per year|per hour/i.test(t)) ?? '';

    return { jobId, title, company, location, salary, url, text, workplaceType };
  })()`,

  // The "Next" pagination control. Absent-or-disabled both mean "no next
  // page" (LinkedIn may do either at the end of results) — returning null
  // either way makes automatic pagination stop cleanly there.
  nextPageRectExpr: rectExprFor(
    `(() => {
      const btn = document.querySelector('button[data-testid="pagination-controls-next-button-visible"]');
      return btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' ? btn : null;
    })()`,
  ),
};
