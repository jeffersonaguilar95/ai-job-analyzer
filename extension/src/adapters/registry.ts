import type { SiteAdapter } from './types';
import { linkedinAdapter } from './linkedin';

/** Add a new job board = register it here. */
const adapters: SiteAdapter[] = [linkedinAdapter];

export function findAdapter(url: string): SiteAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}
