/**
 * Base for Nova's own server API. Local/one-process mode: same origin.
 * For static hosting (e.g. GitHub Pages) + separate server set VITE_NOVA_API_BASE
 * at build time, e.g. https://nova-api.example.workers.dev
 */
const API_BASE = ((import.meta.env.VITE_NOVA_API_BASE as string | undefined) ?? '').trim().replace(/\/$/, '');

/**
 * Static-only build (e.g. GitHub Pages without a server): VITE_NOVA_STATIC=1 and no
 * VITE_NOVA_API_BASE. Then Nova never calls the API and server features show SERVER_NOTE.
 */
export const STATIC_ONLY = import.meta.env.VITE_NOVA_STATIC === '1' && !API_BASE;

export const SERVER_NOTE = 'Braucht den Nova-Server, kommt nach der Server-Einrichtung.';

export function serverNoteHtml(testid = 'server-note'): string {
  return `<p class="bot-status warn server-note" data-testid="${testid}">${SERVER_NOTE}</p>`;
}

export function apiUrl(path: string): string {
  const base = API_BASE;
  const clean = path.replace(/^\//, '');
  if (base) return `${base}/${clean}`;
  return new URL(clean, document.baseURI).toString();
}

const TOKEN_KEY = 'nova.appToken';

/** Optional app access code (NOT the webhook key) – entered by the user in Einstellungen. */
export function getAppToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAppToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function apiHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = getAppToken();
  if (token) headers['X-Nova-Token'] = token;
  return headers;
}

export async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  if (STATIC_ONLY) throw new Error(SERVER_NOTE); // never hit the network in static-only mode
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
