import { apiHeaders, apiUrl, fetchWithTimeout, setAppToken } from './api';
import { openSheet } from './sheet';
import { toast } from './toast';

/**
 * One-time pairing link: …/nova/#/koppeln?code=<NOVA_APP_TOKEN>.
 * The code lives only in the URL fragment (never sent to GitHub Pages), is stored
 * locally and immediately removed from the address bar and the history entry.
 */
export function consumePairingLink(): boolean {
  const match = location.hash.match(/^#\/koppeln\?(.*)$/);
  if (!match) return false;
  const code = new URLSearchParams(match[1]).get('code') ?? '';
  history.replaceState(null, '', `${location.pathname}${location.search}#/chat`);
  if (/^[\w.~-]{16,200}$/.test(code)) {
    setAppToken(code);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Device-code pairing: the app asks the server for a short code, the owner
// approves it via Grok Bot (admin endpoint), the app polls and stores the device token.


export const PAIR_TEXT = {
  button: 'Gerät koppeln',
  title: 'Gerät koppeln',
  intro: 'Dein Kopplungscode:',
  howto: (code: string) => `Schreib deinem Grok Bot: „Kopple Nova mit Code ${code}“. Sobald er bestätigt hat, verbindet sich Nova automatisch.`,
  waiting: 'Warte auf Bestätigung …',
  validFor: (mmss: string) => `Gültig noch ${mmss} Min.`,
  expired: 'Der Code ist abgelaufen.',
  again: 'Neuen Code anfordern',
  cancel: 'Abbrechen',
  done: 'Gerät gekoppelt – Nova Chat ist bereit.',
  tip: 'Du kannst Nova zwischendurch verlassen – der Code bleibt gespeichert. Wichtig auf dem iPhone: in der App koppeln, mit der du chatten willst (Home-Bildschirm-App und Safari speichern getrennt).',
};

export interface PairStart {
  code: string;
  poll_id: string;
  expires_in: number;
  interval: number;
}

export async function requestPairCode(): Promise<PairStart> {
  const res = await fetchWithTimeout(apiUrl('api/pair/start'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 20000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.code) throw new Error(data.message || 'Kopplung konnte nicht gestartet werden.');
  return data as PairStart;
}

export async function pollPair(pollId: string): Promise<{ status: 'pending' | 'approved' | 'expired'; token?: string }> {
  const res = await fetchWithTimeout(apiUrl('api/pair/poll'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ poll_id: pollId }) }, 15000);
  if (!res.ok) throw new Error('poll failed');
  return res.json();
}

const PENDING_KEY = 'nova.pairPending';
interface PendingPair {
  code: string;
  poll_id: string;
  expiresAt: number;
  interval: number;
}

function loadPending(): PendingPair | undefined {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as PendingPair | null;
    return p && p.poll_id && p.expiresAt > Date.now() ? p : undefined;
  } catch {
    return undefined;
  }
}
const savePending = (p: PendingPair) => localStorage.setItem(PENDING_KEY, JSON.stringify(p));
const clearPending = () => localStorage.removeItem(PENDING_KEY);

export function hasPendingPairing(): boolean {
  return Boolean(loadPending());
}

let openSheetCount = 0;

/**
 * Opens the pairing sheet; calls onPaired after the device token was stored.
 * The pending code is kept in localStorage, so leaving the app (e.g. to send the code
 * in the Grok app – iOS may reload the home-screen app meanwhile) does not lose it.
 */
export function openPairingSheet(onPaired?: () => void): void {
  if (openSheetCount > 0) return;
  openSheetCount += 1;
  const content = document.createElement('div');
  content.className = 'pair-sheet';
  content.dataset.testid = 'pair-sheet';
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>${PAIR_TEXT.cancel}</button>`;
  const sheet = openSheet({ title: PAIR_TEXT.title, content, footer });
  let stopped = false;
  let timer = 0;
  let tick = 0;
  let current: PendingPair | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    openSheetCount = Math.max(0, openSheetCount - 1);
    clearTimeout(timer);
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisible);
  };
  footer.querySelector('[data-cancel]')?.addEventListener('click', () => {
    clearPending();
    stop();
    sheet.close();
  });
  // closing via backdrop/Escape/X also stops polling (the code stays resumable until it expires)
  const observer = new MutationObserver(() => {
    if (!content.isConnected) {
      stop();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  const showError = (message: string) => {
    clearInterval(tick);
    content.innerHTML = `<p class="bot-status warn" data-testid="pair-error">${message}</p><button type="button" class="btn btn-primary" data-again>${PAIR_TEXT.again}</button>`;
    content.querySelector('[data-again]')?.addEventListener('click', () => {
      clearPending();
      void run();
    });
  };

  const poll = async () => {
    clearTimeout(timer);
    if (stopped || !current) return;
    if (Date.now() > current.expiresAt) {
      clearPending();
      showError(PAIR_TEXT.expired);
      return;
    }
    try {
      const r = await pollPair(current.poll_id);
      if (stopped) return;
      if (r.status === 'approved' && r.token) {
        setAppToken(r.token);
        clearPending();
        stop();
        sheet.close();
        toast(PAIR_TEXT.done, 'success');
        onPaired?.();
        return;
      }
      if (r.status === 'expired') {
        clearPending();
        showError(PAIR_TEXT.expired);
        return;
      }
    } catch {
      /* network hiccup / server waking up – keep polling */
    }
    timer = window.setTimeout(poll, Math.max(2, current.interval) * 1000);
  };
  // iOS pauses timers in the background: check right away when the app comes back
  const onVisible = () => {
    if (document.visibilityState === 'visible') void poll();
  };
  document.addEventListener('visibilitychange', onVisible);

  const run = async () => {
    clearInterval(tick);
    current = loadPending();
    if (!current) {
      content.innerHTML = `<p class="pair-wait">${PAIR_TEXT.waiting}</p>`;
      try {
        const start = await requestPairCode();
        current = { code: start.code, poll_id: start.poll_id, expiresAt: Date.now() + start.expires_in * 1000, interval: start.interval };
        savePending(current);
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Fehler.');
        return;
      }
    }
    if (stopped) return;
    const p = current;
    content.innerHTML = `
      <p class="pair-intro">${PAIR_TEXT.intro}</p>
      <p class="pair-code" data-testid="pair-code">${p.code}</p>
      <p class="pair-howto">${PAIR_TEXT.howto(p.code)}</p>
      <p class="pair-status"><span class="pair-spinner" aria-hidden="true"></span>${PAIR_TEXT.waiting} <span class="muted" data-left></span></p>
      <p class="pair-tip">${PAIR_TEXT.tip}</p>`;
    const left = content.querySelector('[data-left]') as HTMLElement;
    const render = () => {
      const sec = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000));
      left.textContent = `· ${PAIR_TEXT.validFor(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`)}`;
    };
    render();
    tick = window.setInterval(render, 1000);
    timer = window.setTimeout(poll, 1500);
  };
  void run();
}

/** On app start: an unfinished pairing (e.g. iOS reloaded the app) reopens by itself. */
export function resumePendingPairing(onPaired?: () => void): void {
  if (hasPendingPairing()) openPairingSheet(onPaired);
}

/** Small helper for status checks: is this device accepted by the server? */
export async function deviceAuthorized(): Promise<boolean | undefined> {
  try {
    const res = await fetchWithTimeout(apiUrl('api/chat/status'), { headers: apiHeaders(false) }, 30000);
    if (!res.ok) return undefined;
    const d = await res.json();
    return d.token_required ? Boolean(d.authorized) : true;
  } catch {
    return undefined;
  }
}
