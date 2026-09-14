import type { SiteAdapter } from './types';
import { linkedinAdapter } from './linkedin';
import { welcomeToTheJungleAdapter } from './welcometothejungle';

/** Add a new job board = register it here. */
const adapters: SiteAdapter[] = [linkedinAdapter, welcomeToTheJungleAdapter];

export function findAdapter(url: string): SiteAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}
