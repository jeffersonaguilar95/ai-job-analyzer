import type { SiteAdapter } from './types';

/**
 * SELECTORES PLACEHOLDER — este es justamente el prototipo para calibrarlos
 * en vivo. LinkedIn cambia clases/estructura seguido; si algo no matchea,
 * abrí DevTools sobre linkedin.com/jobs/search con resultados ya cargados
 * y ajustá estas constantes (no hace falta tocar el resto del código).
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

  // El panel de detalle es único en la página (no por tarjeta), así que no
  // necesita el índice — se mantiene en la firma para cumplir el contrato del adapter.
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
