import { attach, detach, evaluate, realClick, realScroll, sleep, type Point } from './lib/cdp';
import { getState, setState, resetState, appendResult, appendDuplicate, dedupeResults, getSettings } from './lib/storage';
import { findAdapter } from './adapters/registry';
import type { SiteAdapter, JobResult, WorkplaceType } from './adapters/types';
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

type Rect = Point & { top: number; bottom: number };

/**
 * Real scroll (mouseWheel) until the element described by rectExpr enters
 * the viewport. Returns its final rect (for the caller to click), or null
 * if it doesn't exist (a card gone past the end of the list, or — for the
 * pagination control — no next page at all). Shared by card-by-card
 * scrolling and scrolling to the "next page" control, which lives at the
 * bottom of the same scrollable results panel.
 */
async function scrollUntilVisible(tabId: number, adapter: SiteAdapter, rectExpr: string): Promise<Rect | null> {
  const containerRect = await evaluate<Point | null>(tabId, adapter.scrollContainerRectExpr);
  const scrollPoint: Point = containerRect ?? { x: 400, y: 400 };

  let rect: Rect | null = null;
  for (let attempt = 0; attempt < adapter.timings.maxScrollAttempts; attempt++) {
    rect = await evaluate<Rect | null>(tabId, rectExpr);
    if (!rect) return null;

    const viewport = await evaluate<{ h: number }>(tabId, '({ h: window.innerHeight })');
    const visible = rect.top >= 0 && rect.bottom <= viewport.h;
    if (visible) return rect;

    const direction = rect.top < 0 ? -1 : 1;
    await realScroll(tabId, scrollPoint, direction * adapter.timings.scrollStepPx);
  }
  return rect;
}

const WORKPLACE_TYPE_LABEL: Record<WorkplaceType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Unknown',
};

type ProcessOutcome =
  | { kind: 'empty' } // the card doesn't exist (yet, or anymore): end of the list
  | { kind: 'duplicate'; jobId: string; title: string; company: string }
  | { kind: 'scored'; result: Omit<JobResult, 'seq'> };

async function processCard(
  tabId: number,
  adapter: SiteAdapter,
  index: number,
  existingJobIds: ReadonlySet<string>,
): Promise<ProcessOutcome> {
  const rect = await scrollUntilVisible(tabId, adapter, adapter.cardRectExpr(index));
  if (!rect) return { kind: 'empty' };

  await realClick(tabId, rect);

  for (let attempt = 0; attempt < adapter.timings.maxDetailWaitAttempts; attempt++) {
    const ready = await evaluate<boolean>(tabId, adapter.detailReadyExpr);
    if (ready) break;
    await sleep(adapter.timings.afterClickMs);
  }

  const extracted = await evaluate<{
    jobId: string;
    title: string;
    company: string;
    location: string;
    salary: string;
    url: string;
    text: string;
    workplaceType: WorkplaceType;
  }>(tabId, adapter.extractExpr(index));

  // Authoritative dedup check: by now the card has been scrolled to and
  // clicked, so `extracted.jobId` (built from the same ID that's in the
  // job's URL) is reliable — unlike a pre-click preview, which can miss
  // cards LinkedIn hasn't fully rendered yet. Still costs the scroll+click,
  // but skips the one part worth avoiding: the paid LLM call below.
  if (extracted.jobId && existingJobIds.has(extracted.jobId)) {
    return { kind: 'duplicate', jobId: extracted.jobId, title: extracted.title, company: extracted.company };
  }

  // Postings LinkedIn itself tags Hybrid/On-site slip through the search's
  // "Remote" filter often enough to be worth filtering client-side. Skipped
  // before the (paid) LLM call, not after — this is the actual cost saved.
  // 'unknown' still goes through normal scoring: an unrecognized DOM shape
  // should never silently discard a posting that might be remote.
  const isNonRemote = extracted.workplaceType === 'hybrid' || extracted.workplaceType === 'onsite';

  const { score, strengths, gaps, reasoning } = isNonRemote
    ? {
        score: 0,
        strengths: [],
        gaps: [`Workplace type: ${WORKPLACE_TYPE_LABEL[extracted.workplaceType]}`],
        reasoning: `Discarded — LinkedIn lists this job as ${WORKPLACE_TYPE_LABEL[extracted.workplaceType]}, not Remote.`,
      }
    : await analyzeWithGoService(extracted);

  return {
    kind: 'scored',
    result: {
      index,
      jobId: extracted.jobId,
      title: extracted.title,
      company: extracted.company,
      location: extracted.location,
      salary: extracted.salary,
      url: extracted.url,
      text: extracted.text,
      workplaceType: extracted.workplaceType,
      discarded: isNonRemote,
      score,
      strengths,
      gaps,
      reasoning,
      scoredAt: new Date().toISOString(),
    },
  };
}

/**
 * Clicks the adapter's "next page" control and waits for the new page's
 * cards to load. Returns false (no click attempted) if the adapter reports
 * there's no next page — the caller treats that as genuinely out of
 * results, not just a batch-size stop.
 */
async function goToNextPage(tabId: number, adapter: SiteAdapter): Promise<boolean> {
  const rect = await scrollUntilVisible(tabId, adapter, adapter.nextPageRectExpr);
  if (!rect) return false;

  await realClick(tabId, rect);

  for (let attempt = 0; attempt < adapter.timings.maxPageLoadWaitAttempts; attempt++) {
    const count = await evaluate<number>(tabId, adapter.countCardsExpr);
    if (count > 0) break;
    await sleep(adapter.timings.afterClickMs);
  }

  return true;
}

async function runLoop(tabId: number, adapter: SiteAdapter, maxPagesPerBatch: number): Promise<void> {
  let pagesThisBatch = 0;

  while (true) {
    const state = await getState();
    if (state.status !== 'running') break; // Stop requested: nothing already processed is lost

    const count = await evaluate<number>(tabId, adapter.countCardsExpr);
    await setState({ currentPageCount: count });
    if (state.currentIndex >= count) {
      pagesThisBatch++;

      if (pagesThisBatch >= maxPagesPerBatch) {
        // Hit the batch cap with (likely) more pages left — stop without
        // advancing, so the next Start click can tell "click next first"
        // (batchLimitReached) apart from "genuinely done" (done).
        //
        // Re-checked against fresh state (not the `state` read at the top of
        // this iteration): a Stop+Clear can land while goToNextPage/waits
        // above were in flight, and blindly writing pagesCompleted computed
        // from the stale snapshot would resurrect a counter Clear just reset.
        const latest = await getState();
        if (latest.status !== 'running') break;
        await setState({ status: 'batchLimitReached', pagesCompleted: latest.pagesCompleted + 1 });
        break;
      }

      const advanced = await goToNextPage(tabId, adapter);

      const latest = await getState();
      if (latest.status !== 'running') break;

      if (!advanced) {
        await setState({ status: 'done', pagesCompleted: latest.pagesCompleted + 1 });
        break;
      }

      await setState({ pagesCompleted: latest.pagesCompleted + 1, currentIndex: 0, currentPageCount: null });
      continue;
    }

    // Best-effort only, for the "currently processing" indicator — not
    // authoritative for dedup, since LinkedIn may not have this card fully
    // rendered yet at this point (see processCard for the real check).
    const preview = await evaluate<{ jobId: string; title: string; company: string } | null>(
      tabId,
      adapter.cardPreviewExpr(state.currentIndex),
    );
    await setState({
      currentJob: preview
        ? { index: state.currentIndex, jobId: preview.jobId, title: preview.title, company: preview.company }
        : null,
    });

    const existingJobIds = new Set(state.results.map((r) => r.jobId));

    try {
      const outcome = await processCard(tabId, adapter, state.currentIndex, existingJobIds);
      if (outcome.kind === 'scored') {
        await appendResult(outcome.result);
      } else if (outcome.kind === 'duplicate') {
        console.log('[ai-job-analyzer] Skipping already-scored job', outcome.jobId);
        await appendDuplicate({
          index: state.currentIndex,
          jobId: outcome.jobId,
          title: outcome.title,
          company: outcome.company,
          skippedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[ai-job-analyzer] Error processing card', state.currentIndex, err);
    } finally {
      await setState({ currentJob: null });
    }

    // Same staleness guard as above: processCard can take a while (a slow
    // LLM call), long enough for a Stop+Clear to land mid-flight.
    const latestAfterCard = await getState();
    if (latestAfterCard.status !== 'running') break;
    await setState({ currentIndex: latestAfterCard.currentIndex + 1 });
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

  await attach(tab.id!);

  const sameTabAndAdapter = current.tabId === tab.id && current.adapterId === adapter.id;
  const resumingSamePage = current.status === 'paused' && sameTabAndAdapter;
  const continuingNextBatch = current.status === 'batchLimitReached' && sameTabAndAdapter;

  if (continuingNextBatch) {
    // The previous batch stopped right after finishing a page (without
    // advancing) specifically so this click could click "next" first.
    await goToNextPage(tab.id!, adapter);
    await setState({ currentIndex: 0, currentPageCount: null, error: null });
  } else if (!resumingSamePage) {
    // Not resuming the exact page we paused on: treat this as a fresh page
    // (e.g. the user navigated to LinkedIn's next results page and clicked
    // Start again). Card indices are per-page, so restart counting from 0 —
    // but keep `results` accumulating across pages instead of wiping it, so
    // one CSV/JSON export covers everything scored so far.
    await setState({ currentIndex: 0, error: null });
  }

  await setState({ status: 'running', tabId: tab.id!, adapterId: adapter.id });

  const { maxPagesPerBatch } = await getSettings();
  runLoop(tab.id!, adapter, maxPagesPerBatch).catch(async (err) => {
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

async function clear(): Promise<ExtensionResponse> {
  const current = await getState();
  if (current.status === 'running') return { ok: false, error: 'Stop the run before clearing results.' };
  await resetState();
  return { ok: true };
}

/**
 * Collapses `results` down to one entry per jobId (keeping the earliest,
 * i.e. lowest `seq`), for cleaning up duplicates that were scored twice
 * before jobId came from the detail panel URL instead of the card's
 * componentkey. Unlike Clear, this only touches `results` — nothing is
 * reprocessed, so no tokens are spent re-running anything.
 */
async function dedupe(): Promise<ExtensionResponse> {
  const current = await getState();
  if (current.status === 'running') return { ok: false, error: 'Stop the run before removing duplicates.' };

  const deduped = dedupeResults(current.results);
  const removed = current.results.length - deduped.length;
  await setState({ results: deduped });
  return { ok: true, data: { removed } };
}

/**
 * Re-runs analyzeWithGoService for every result with score: null. No
 * LinkedIn interaction at all — `text`/`title`/`company` are already
 * stored from the original extraction, so this is just a fetch to
 * matching-service per candidate, same as the original scoring call.
 * Entries with no stored `text` (the description was never captured) are
 * skipped — retrying those would just 400 again, since there's nothing to
 * re-send that would change.
 */
async function rescoreNulls(): Promise<ExtensionResponse> {
  const current = await getState();
  if (current.status === 'running') return { ok: false, error: 'Stop the run before rescoring.' };

  const candidates = current.results.filter((r) => r.score === null);
  const retryable = candidates.filter((r) => r.text);
  let rescored = 0;

  for (const r of retryable) {
    const { score, strengths, gaps, reasoning } = await analyzeWithGoService(r);
    if (score !== null) rescored++;

    const latest = await getState();
    const updated = latest.results.map((x) =>
      x.seq === r.seq ? { ...x, score, strengths, gaps, reasoning, scoredAt: new Date().toISOString() } : x,
    );
    await setState({ results: updated });
  }

  return {
    ok: true,
    data: { attempted: retryable.length, rescored, skippedNoText: candidates.length - retryable.length },
  };
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
      case 'CLEAR':
        sendResponse(await clear());
        break;
      case 'DEDUPE':
        sendResponse(await dedupe());
        break;
      case 'RESCORE':
        sendResponse(await rescoreNulls());
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
