import { attach, detach, evaluate, realClick, realScroll, sleep, type Point } from './lib/cdp';
import { getState, setState, resetState, appendResult } from './lib/storage';
import { findAdapter } from './adapters/registry';
import type { SiteAdapter, JobResult } from './adapters/types';
import type { ExtensionMessage, ExtensionResponse } from './lib/messaging';

/** URL del servicio local en Go (todavía no implementado — ver matching-service/). */
const GO_SERVICE_URL = 'http://localhost:8787/analyze';

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) throw new Error('No hay una pestaña activa válida.');
  return tab;
}

async function analyzeWithGoService(
  job: Pick<JobResult, 'title' | 'company' | 'text'>,
): Promise<{ score: number | null; reasoning: string | null }> {
  try {
    const res = await fetch(GO_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!res.ok) throw new Error(`Servicio Go respondió ${res.status}`);
    const data = (await res.json()) as { score?: number; reasoning?: string };
    return { score: data.score ?? null, reasoning: data.reasoning ?? null };
  } catch (err) {
    console.warn('[ai-job-analyzer] Servicio Go no disponible todavía:', err);
    return { score: null, reasoning: 'Servicio de matching (Go) no disponible.' };
  }
}

/** Hace scroll real (mouseWheel) hasta que la tarjeta N entre en el viewport. */
async function scrollCardIntoView(tabId: number, adapter: SiteAdapter, index: number): Promise<void> {
  const containerRect = await evaluate<Point | null>(tabId, adapter.scrollContainerRectExpr);
  const scrollPoint: Point = containerRect ?? { x: 400, y: 400 };

  for (let attempt = 0; attempt < adapter.timings.maxScrollAttempts; attempt++) {
    const rect = await evaluate<{ top: number; bottom: number } | null>(tabId, adapter.cardRectExpr(index));
    if (!rect) return; // la tarjeta no existe todavía (o ya no existe): fin de la lista

    const viewport = await evaluate<{ h: number }>(tabId, '({ h: window.innerHeight })');
    const visible = rect.top >= 0 && rect.bottom <= viewport.h;
    if (visible) return;

    const direction = rect.top < 0 ? -1 : 1;
    await realScroll(tabId, scrollPoint, direction * adapter.timings.scrollStepPx);
  }
}

async function processCard(tabId: number, adapter: SiteAdapter, index: number): Promise<JobResult | null> {
  await scrollCardIntoView(tabId, adapter, index);

  const rect = await evaluate<Point | null>(tabId, adapter.cardRectExpr(index));
  if (!rect) return null;

  await realClick(tabId, rect);
  await sleep(adapter.timings.afterClickMs);

  const extracted = await evaluate<{ title: string; company: string; location: string; url: string; text: string }>(
    tabId,
    adapter.extractExpr(index),
  );

  const { score, reasoning } = await analyzeWithGoService(extracted);

  return {
    index,
    title: extracted.title,
    company: extracted.company,
    location: extracted.location,
    url: extracted.url,
    text: extracted.text,
    score,
    reasoning,
    scoredAt: new Date().toISOString(),
  };
}

async function runLoop(tabId: number, adapter: SiteAdapter): Promise<void> {
  while (true) {
    const state = await getState();
    if (state.status !== 'running') break; // Stop pedido: no se pierde lo ya procesado

    const count = await evaluate<number>(tabId, adapter.countCardsExpr);
    if (state.currentIndex >= count) {
      await setState({ status: 'done' });
      break;
    }

    try {
      const result = await processCard(tabId, adapter, state.currentIndex);
      if (result) await appendResult(result);
    } catch (err) {
      console.error('[ai-job-analyzer] Error procesando tarjeta', state.currentIndex, err);
    }

    await setState({ currentIndex: state.currentIndex + 1 });
    await sleep(adapter.timings.betweenCardsMs);
  }

  await detach(tabId).catch(() => {});
}

async function start(): Promise<ExtensionResponse> {
  const current = await getState();
  if (current.status === 'running') return { ok: false, error: 'Ya está corriendo.' };

  const tab = await getActiveTab();
  const adapter = findAdapter(tab.url!);
  if (!adapter) return { ok: false, error: `No hay adapter para esta URL: ${tab.url}` };

  const resuming = current.status === 'paused' && current.tabId === tab.id && current.adapterId === adapter.id;
  if (!resuming) await resetState();

  await attach(tab.id!);
  await setState({ status: 'running', tabId: tab.id!, adapterId: adapter.id });

  runLoop(tab.id!, adapter).catch(async (err) => {
    console.error('[ai-job-analyzer] runLoop falló:', err);
    await setState({ status: 'error', error: String(err) });
    await detach(tab.id!).catch(() => {});
  });

  return { ok: true };
}

async function stop(): Promise<ExtensionResponse> {
  // El loop chequea el status al principio de cada vuelta: como mucho termina
  // la tarjeta que ya estaba procesando y se detiene ahí, sin perder resultados.
  await setState({ status: 'paused' });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'START':
        sendResponse(await start());
        break;
      case 'STOP':
        sendResponse(await stop());
        break;
      case 'GET_STATE':
        sendResponse({ ok: true, data: await getState() });
        break;
    }
  })();
  return true; // indica respuesta asíncrona
});

// Si el usuario cierra manualmente el banner "esta extensión está depurando
// este navegador", tratamos eso como un Stop, no como un crash silencioso.
chrome.debugger.onDetach.addListener(async (_source, reason) => {
  console.warn('[ai-job-analyzer] Debugger desconectado:', reason);
  const state = await getState();
  if (state.status === 'running') await setState({ status: 'paused' });
});
