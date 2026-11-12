import type { RouteName } from './types';

/** Hash-Routen. Neue Module hier eintragen. */
export const ROUTE_HASHES: Record<RouteName, string> = {
  overview: '#/',
  todos: '#/aufgaben',
  calendar: '#/kalender',
  finance: '#/finanzen',
  goals: '#/ziele',
  grok: '#/grok',
  settings: '#/einstellungen',
  chat: '#/chat',
  morning: '#/morgen',
  habits: '#/gewohnheiten',
  morningPlan: '#/morgenplan',
};

function hashPath(): string {
  return location.hash.split('?')[0];
}

export function currentRoute(): RouteName {
  const path = hashPath();
  if (path === '' || path === '#' || path === '#/' || path === '#/uebersicht') return 'overview';
  const found = (Object.entries(ROUTE_HASHES) as [RouteName, string][]).find(([, hash]) => hash === path);
  return found ? found[0] : 'overview';
}

export function routeParams(): URLSearchParams {
  const query = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query);
}

export function navigate(route: RouteName, params?: Record<string, string>): void {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  const hash = `${ROUTE_HASHES[route]}${query}`;
  if (location.hash !== hash) location.hash = hash;
}

export function onRouteChange(handler: () => void): () => void {
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
