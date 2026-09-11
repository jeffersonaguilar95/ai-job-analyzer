import type { SiteAdapter } from './types';
import { linkedinAdapter } from './linkedin';

/** Agregar un portal nuevo = sumarlo acá. */
const adapters: SiteAdapter[] = [linkedinAdapter];

export function findAdapter(url: string): SiteAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}
