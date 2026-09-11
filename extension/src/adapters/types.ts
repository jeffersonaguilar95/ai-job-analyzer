export interface JobResult {
  index: number;
  title: string;
  company: string;
  location: string;
  url: string;
  text: string;
  score: number | null;
  reasoning: string | null;
  scoredAt: string | null;
}

export interface AdapterTimings {
  /** Espera tras el click, antes de leer el panel de detalle (a calibrar en vivo). */
  afterClickMs: number;
  /** Espera entre una tarjeta y la siguiente. */
  betweenCardsMs: number;
  /** Magnitud de cada paso de scroll (px equivalentes de deltaY). */
  scrollStepPx: number;
  maxScrollAttempts: number;
}

/**
 * Un adapter traduce el "qué" (contar tarjetas, ubicar una, extraer texto)
 * en expresiones JS que se evalúan en la página vía Runtime.evaluate.
 * Agregar un portal nuevo = escribir un adapter nuevo, sin tocar el loop
 * de background.ts.
 */
export interface SiteAdapter {
  id: string;
  label: string;
  matches(url: string): boolean;
  timings: AdapterTimings;
  /** Expresión que devuelve la cantidad de tarjetas de resultado visibles en el DOM. */
  countCardsExpr: string;
  /** Expresión que devuelve {x,y,top,bottom} del centro/límites de la tarjeta N, o null. */
  cardRectExpr(index: number): string;
  /** Punto de referencia (dentro del contenedor de la lista) para disparar el scroll. */
  scrollContainerRectExpr: string;
  /** Expresión que extrae {title, company, location, url, text} tras hacer click en la tarjeta N. */
  extractExpr(index: number): string;
}
