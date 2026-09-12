import type { ExtensionMessage, ExtensionResponse } from './lib/messaging';
import type { RunState } from './lib/storage';
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

function renderState(state: RunState): void {
  const statusEl = document.getElementById('status')!;
  const pageProgress =
    state.currentPageCount !== null ? `${Math.min(state.currentIndex, state.currentPageCount)}/${state.currentPageCount}` : '—';
  statusEl.textContent =
    `Status: ${state.status} — page ${pageProgress} — ` +
    `${state.pagesCompleted} page(s) completed — ${state.results.length} scored total`;

  const errorEl = document.getElementById('error')!;
  errorEl.textContent = state.error ?? '';

  const isRunning = state.status === 'running';
  (document.getElementById('start') as HTMLButtonElement).hidden = isRunning;
  (document.getElementById('stop') as HTMLButtonElement).hidden = !isRunning;
  (document.getElementById('clear') as HTMLButtonElement).disabled = isRunning;

  const tbody = document.querySelector('#results tbody')!;
  tbody.innerHTML = '';
  for (const r of byScoreDesc(state.results)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.score ?? '—'}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.company)}</td>`;
    tbody.appendChild(tr);
  }
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
  if (res.ok && res.data) download('job-matches.csv', 'text/csv', toCsv(byScoreDesc((res.data as RunState).results)));
});

document.getElementById('exportJson')!.addEventListener('click', async () => {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) download('job-matches.json', 'application/json', toExportJson(byScoreDesc((res.data as RunState).results)));
});

document.getElementById('clear')!.addEventListener('click', async () => {
  const res = await send({ type: 'CLEAR' });
  await refresh();
  if (!res.ok) {
    console.error('[ai-job-analyzer] Clear failed:', res.error);
    document.getElementById('error')!.textContent = res.error;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.runState) void refresh();
});

void refresh();
