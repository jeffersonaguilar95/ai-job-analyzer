import { attach, detach, evaluate, realClick, realScroll, sleep, type Point } from './lib/cdp';
import { getState, setState, appendResult } from './lib/storage';
import { findAdapter } from './adapters/registry';
import type { SiteAdapter, JobResult } from './adapters/types';
import type { ExtensionMessage, ExtensionResponse } from './lib/messaging';

/** URL of the local Go service (not implemented yet — see matching-service/). */
const GO_SERVICE_URL = 'http://localhost:8787/analyze';

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) throw new Error('No valid active tab found.');
  return tab;
}

async function analyzeWithGoService(
  job: Pick<JobResult, 'title' | 'company' | 'text'>,
): Promise<Pick<JobResult, 'score' | 'strengths' | 'gaps' | 'reasoning'>> {
  try {
    const res = await fetch(GO_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!res.ok) throw new Error(`Go service responded ${res.status}`);
    const data = (await res.json()) as {
      score?: number;
      strengths?: string[];
      gaps?: string[];
      reasoning?: string;
    };
    return {
      score: data.score ?? null,
      strengths: data.strengths ?? [],
      gaps: data.gaps ?? [],
      reasoning: data.reasoning ?? null,
    };
  } catch (err) {
    console.warn('[ai-job-analyzer] Go service not available yet:', err);
    return { score: null, strengths: [], gaps: [], reasoning: 'Matching service (Go) not available.' };
  }
}

/** Real scroll (mouseWheel) until card N enters the viewport. */
async function scrollCardIntoView(tabId: number, adapter: SiteAdapter, index: number): Promise<void> {
  const containerRect = await evaluate<Point | null>(tabId, adapter.scrollContainerRectExpr);
  const scrollPoint: Point = containerRect ?? { x: 400, y: 400 };

  for (let attempt = 0; attempt < adapter.timings.maxScrollAttempts; attempt++) {
    const rect = await evaluate<{ top: number; bottom: number } | null>(tabId, adapter.cardRectExpr(index));
    if (!rect) return; // the card doesn't exist (yet, or anymore): end of the list

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

  const { score, strengths, gaps, reasoning } = await analyzeWithGoService(extracted);

  return {
    index,
    title: extracted.title,
    company: extracted.company,
    location: extracted.location,
    url: extracted.url,
    text: extracted.text,
    score,
    strengths,
    gaps,
    reasoning,
    scoredAt: new Date().toISOString(),
  };
}

async function runLoop(tabId: number, adapter: SiteAdapter): Promise<void> {
  while (true) {
    const state = await getState();
    if (state.status !== 'running') break; // Stop requested: nothing already processed is lost

    const count = await evaluate<number>(tabId, adapter.countCardsExpr);
    if (state.currentIndex >= count) {
      await setState({ status: 'done' });
      break;
    }

    try {
      const result = await processCard(tabId, adapter, state.currentIndex);
      if (result) await appendResult(result);
    } catch (err) {
      console.error('[ai-job-analyzer] Error processing card', state.currentIndex, err);
    }

    await setState({ currentIndex: state.currentIndex + 1 });
    await sleep(adapter.timings.betweenCardsMs);
  }

  await detach(tabId).catch(() => {});
}

async function start(): Promise<ExtensionResponse> {
  const current = await getState();
  if (current.status === 'running') return { ok: false, error: 'Already running.' };

  const tab = await getActiveTab();
  const adapter = findAdapter(tab.url!);
  if (!adapter) return { ok: false, error: `No adapter for this URL: ${tab.url}` };

  const resumingSamePage = current.status === 'paused' && current.tabId === tab.id && current.adapterId === adapter.id;
  if (!resumingSamePage) {
    // Not resuming the exact page we paused on: treat this as a fresh page
    // (e.g. the user navigated to LinkedIn's next results page and clicked
    // Start again). Card indices are per-page, so restart counting from 0 —
    // but keep `results` accumulating across pages instead of wiping it, so
    // one CSV/JSON export covers everything scored so far.
    await setState({ currentIndex: 0, error: null });
  }

  await attach(tab.id!);
  await setState({ status: 'running', tabId: tab.id!, adapterId: adapter.id });

  runLoop(tab.id!, adapter).catch(async (err) => {
    console.error('[ai-job-analyzer] runLoop failed:', err);
    await setState({ status: 'error', error: String(err) });
    await detach(tab.id!).catch(() => {});
  });

  return { ok: true };
}

async function stop(): Promise<ExtensionResponse> {
  // The loop checks status at the top of every iteration: at most it finishes
  // the card it was already processing and stops there, without losing results.
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
  return true; // signals an asynchronous response
});

// If the user manually closes the "this extension is debugging this browser"
// banner, treat that as a Stop, not a silent crash.
chrome.debugger.onDetach.addListener(async (_source, reason) => {
  console.warn('[ai-job-analyzer] Debugger detached:', reason);
  const state = await getState();
  if (state.status === 'running') await setState({ status: 'paused' });
});
