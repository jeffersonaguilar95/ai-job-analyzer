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

function renderState(state: RunState): void {
  const statusEl = document.getElementById('status')!;
  statusEl.textContent = `Status: ${state.status} — ${state.results.length} processed (index ${state.currentIndex})`;

  const errorEl = document.getElementById('error')!;
  errorEl.textContent = state.error ?? '';

  const tbody = document.querySelector('#results tbody')!;
  tbody.innerHTML = '';
  const sorted = [...state.results].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  for (const r of sorted) {
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
  const header = ['score', 'title', 'company', 'location', 'url'];
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of results) {
    lines.push([escape(r.score ?? ''), escape(r.title), escape(r.company), escape(r.location), escape(r.url)].join(','));
  }
  return lines.join('\n');
}

async function refresh(): Promise<void> {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) renderState(res.data as RunState);
}

document.getElementById('start')!.addEventListener('click', async () => {
  const res = await send({ type: 'START' });
  if (!res.ok) alert(res.error);
  await refresh();
});

document.getElementById('stop')!.addEventListener('click', async () => {
  await send({ type: 'STOP' });
  await refresh();
});

document.getElementById('exportCsv')!.addEventListener('click', async () => {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) download('job-matches.csv', 'text/csv', toCsv((res.data as RunState).results));
});

document.getElementById('exportJson')!.addEventListener('click', async () => {
  const res = await send({ type: 'GET_STATE' });
  if (res.ok && res.data) download('job-matches.json', 'application/json', JSON.stringify((res.data as RunState).results, null, 2));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.runState) void refresh();
});

void refresh();
