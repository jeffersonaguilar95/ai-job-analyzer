import type { SiteAdapter } from './types';

/**
 * PLACEHOLDER SELECTORS — this is exactly the prototype meant to calibrate
 * them live. LinkedIn changes classes/structure often; if something doesn't
 * match, open DevTools on linkedin.com/jobs/search with results already
 * loaded and adjust these constants (no need to touch the rest of the code).
 */
const CARD_SELECTOR = 'li.jobs-search-results__list-item, div.job-card-container';
const LIST_SELECTOR = 'div.jobs-search-results-list, ul.scaffold-layout__list-container';
const TITLE_SELECTOR = '.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title';
const COMPANY_SELECTOR = '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name';
const LOCATION_SELECTOR =
  '.job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet';
const DESCRIPTION_SELECTOR = '#job-details, .jobs-description__content';

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

  scrollContainerRectExpr: rectExprFor(`document.querySelector('${LIST_SELECTOR}')`),

  // The detail panel is unique on the page (not per card), so it doesn't
  // need the index — kept in the signature to satisfy the adapter contract.
  extractExpr: (_index) => `(() => {
    const titleEl = document.querySelector('${TITLE_SELECTOR}');
    const companyEl = document.querySelector('${COMPANY_SELECTOR}');
    const locationEl = document.querySelector('${LOCATION_SELECTOR}');
    const descEl = document.querySelector('${DESCRIPTION_SELECTOR}');
    return {
      title: titleEl ? titleEl.innerText.trim() : '',
      company: companyEl ? companyEl.innerText.trim() : '',
      location: locationEl ? locationEl.innerText.trim() : '',
      url: location.href,
      text: descEl ? descEl.innerText.trim() : '',
    };
  })()`,
};
