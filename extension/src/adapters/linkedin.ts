import type { SiteAdapter } from './types';

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

function rectExprFor(elementExpr: string): string {
  return `(() => {
    const el = ${elementExpr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, height: r.height };
  })()`;
}

export const linkedinAdapter: SiteAdapter = {
  id: 'linkedin',
  label: 'LinkedIn',
  matches: (url) => /^https:\/\/(www\.)?linkedin\.com\/jobs\//.test(url),

  timings: {
    afterClickMs: 1200,
    betweenCardsMs: 400,
    scrollStepPx: 260,
    maxScrollAttempts: 10,
  },

  countCardsExpr: `document.querySelectorAll('${CARD_SELECTOR}').length`,

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

  // Title/company/location live on the card itself, so they're read straight
  // from it (no dependency on the detail panel's DOM). The title paragraph
  // is the only one with a nested `span[aria-hidden]` before the card's
  // footer metadata, so it's found by that; company/location are the next
  // two plain paragraphs in DOM order.
  //
  // The canonical URL and full description come from the detail panel that
  // opens after the click, scoped to the last `SemanticJobDetails` screen
  // (there may be stale ones left in the DOM from earlier cards) so we don't
  // cross into the sibling "About the company" section, which has its own
  // `expandable-text-box`.
  extractExpr: (index) => `(() => {
    const card = document.querySelectorAll('${CARD_SELECTOR}')[${index}];
    if (!card) return { title: '', company: '', location: '', url: location.href, text: '' };
    const paragraphs = [...card.querySelectorAll('p')];
    const titleSpan = card.querySelector('p span[aria-hidden="true"]');
    const title = titleSpan ? titleSpan.textContent.trim() : (paragraphs[0]?.innerText.trim() ?? '');
    const company = paragraphs[1] ? paragraphs[1].innerText.trim() : '';
    const location = paragraphs[2] ? paragraphs[2].innerText.trim() : '';

    const panels = document.querySelectorAll('[data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"]');
    const panel = panels[panels.length - 1] ?? null;

    const titleLink = panel ? panel.querySelector('a[href*="/jobs/view/"]') : null;
    const url = titleLink ? titleLink.href : location.href;

    const aboutJob = panel ? panel.querySelector('[id^="JobDetails_AboutTheJob_"]') : null;
    const descEl = aboutJob ? aboutJob.querySelector('span[data-testid="expandable-text-box"]') : null;
    const text = descEl ? descEl.innerText.trim() : '';

    return { title, company, location, url, text };
  })()`,
};
