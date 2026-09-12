import type { ExtensionMessage, ExtensionResponse } from './lib/messaging';
import type { RunState } from './lib/storage';
import { dedupeResults, getSettings, setSettings } from './lib/storage';
import type { JobResult } from './adapters/types';

function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function byScoreDesc(results: JobResult[]): JobResult[] {
  return [...results].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

function humanizeStatus(status: string): string {
  return status.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function renderState(state: RunState): void {
  const statusEl = document.getElementById('status')!;
  statusEl.textContent = `Status: ${humanizeStatus(state.status)}`;

  const stats = [];
  if (state.currentPageCount !== null) {
    stats.push(`page ${Math.min(state.currentIndex, state.currentPageCount)}/${state.currentPageCount}`);
  }
  stats.push(`${state.pagesCompleted} page(s) completed`);
  stats.push(`${state.results.length} processed`);
  stats.push(`${state.duplicates.length} duplicates skipped`);
  document.getElementById('stats')!.textContent = stats.join(' · ');

  const errorEl = document.getElementById('error')!;
  errorEl.textContent = state.error ?? '';

  const isRunning = state.status === 'running';
  (document.getElementById('start') as HTMLButtonElement).hidden = isRunning;
  (document.getElementById('stop') as HTMLButtonElement).hidden = !isRunning;
  (document.getElementById('clear') as HTMLButtonElement).disabled = isRunning;
  (document.getElementById('dedupe') as HTMLButtonElement).disabled = isRunning;
  (document.getElementById('rescore') as HTMLButtonElement).disabled = isRunning;
  (document.getElementById('maxPages') as HTMLInputElement).disabled = isRunning;

  const tbody = document.querySelector('#results tbody')!;
  tbody.innerHTML = '';

  if (state.currentJob) {
    const tr = document.createElement('tr');
    tr.className = 'processing';
    tr.innerHTML = `<td>…</td><td>${escapeHtml(state.currentJob.title)}</td><td>${escapeHtml(state.currentJob.company)}</td><td>${escapeHtml(state.currentJob.jobId)}</td>`;
    tbody.appendChild(tr);
  }

  // Stack order (most recently processed first), interleaving scored results
  // and skipped duplicates by their shared `seq` — the true processing
  // order, unlike per-page `index`.
  type Row = { seq: number; el: HTMLTableRowElement };
  const rows: Row[] = [];
  for (const r of state.results) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.score ?? '—'}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.company)}</td><td>${escapeHtml(r.jobId)}</td>`;
    rows.push({ seq: r.seq, el: tr });
  }
  for (const d of state.duplicates) {
    const tr = document.createElement('tr');
    tr.className = 'duplicate';
    tr.innerHTML = `<td>dup</td><td>${escapeHtml(d.title)}</td><td>${escapeHtml(d.company)}</td><td>${escapeHtml(d.jobId)}</td>`;
    rows.push({ seq: d.seq, el: tr });
  }
  rows.sort((a, b) => b.seq - a.seq);
  for (const row of rows) tbody.appendChild(row.el);
}

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => URL.revokeObjectURL(url));
}

function toCsv(results: JobResult[]): string {
  const header = ['score', 'title', 'company', 'location', 'salary', 'url', 'strengths', 'gaps', 'reasoning'];
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const joinPoints = (points: string[]) => points.map((p) => `- ${p}`).join('\n');
  const lines = [header.join(',')];
  for (const r of results) {
    lines.push(
      [
        escape(r.score ?? ''),
        escape(r.title),
        escape(r.company),
        escape(r.location),
        escape(r.salary),
        escape(r.url),
        escape(joinPoints(r.strengths)),
        escape(joinPoints(r.gaps)),
        escape(r.reasoning ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Export shape: same as JobResult minus `text` (the raw JD body), which is
 * redundant once you have the job's `url`. */
function toExportJson(results: JobResult[]): string {
  const exportable = results.map(({ text: _text, ...rest }) => rest);
  return JSON.stringify(exportable, null, 2);
}

async function refresh(): Promise<void> {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) renderState(res.data as RunState);
}

document.getElementById('start')!.addEventListener('click', async () => {
  const res = await send({ type: 'START' });
  await refresh();
  if (!res.ok) {
    console.error('[ai-job-analyzer] Start failed:', res.error);
    document.getElementById('error')!.textContent = res.error;
  }
});

document.getElementById('stop')!.addEventListener('click', async () => {
  await send({ type: 'STOP' });
  await refresh();
});

document.getElementById('exportCsv')!.addEventListener('click', async () => {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) download('job-matches.csv', 'text/csv', toCsv(byScoreDesc(dedupeResults((res.data as RunState).results))));
});

document.getElementById('exportJson')!.addEventListener('click', async () => {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) {
    download('job-matches.json', 'application/json', toExportJson(byScoreDesc(dedupeResults((res.data as RunState).results))));
  }
});

document.getElementById('clear')!.addEventListener('click', async () => {
  const res = await send({ type: 'CLEAR' });
  await refresh();
  if (!res.ok) {
    console.error('[ai-job-analyzer] Clear failed:', res.error);
    document.getElementById('error')!.textContent = res.error;
  }
});

document.getElementById('dedupe')!.addEventListener('click', async () => {
  const res = await send({ type: 'DEDUPE' });
  await refresh();
  if (!res.ok) {
    console.error('[ai-job-analyzer] Dedupe failed:', res.error);
    document.getElementById('error')!.textContent = res.error;
  } else {
    const removed = (res.data as { removed: number } | undefined)?.removed ?? 0;
    document.getElementById('error')!.textContent = `Removed ${removed} duplicate result(s).`;
  }
});

document.getElementById('rescore')!.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  const res = await send({ type: 'RESCORE' });
  await refresh();
  if (!res.ok) {
    console.error('[ai-job-analyzer] Rescore failed:', res.error);
    document.getElementById('error')!.textContent = res.error;
  } else {
    const data = res.data as { attempted: number; rescored: number; skippedNoText: number } | undefined;
    const skippedNote = data?.skippedNoText ? ` (${data.skippedNoText} skipped — no stored description)` : '';
    document.getElementById('error')!.textContent = `Rescored ${data?.rescored ?? 0}/${data?.attempted ?? 0} null result(s)${skippedNote}.`;
  }
  btn.disabled = false;
});

document.getElementById('maxPages')!.addEventListener('change', async (e) => {
  const raw = parseInt((e.target as HTMLInputElement).value, 10);
  const value = Number.isFinite(raw) ? Math.max(1, raw) : 5;
  await setSettings({ maxPagesPerBatch: value });
  (document.getElementById('maxPages') as HTMLInputElement).value = String(value);
});

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  (document.getElementById('maxPages') as HTMLInputElement).value = String(settings.maxPagesPerBatch);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.runState) void refresh();
});

void refresh();
void loadSettings();
