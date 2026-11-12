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

/** Opens the pairing sheet; calls onPaired after the device token was stored. */
export function openPairingSheet(onPaired?: () => void): void {
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
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(tick);
  };
  footer.querySelector('[data-cancel]')?.addEventListener('click', () => {
    stop();
    sheet.close();
  });
  // closing via backdrop/Escape/X also stops polling
  const observer = new MutationObserver(() => {
    if (!content.isConnected) {
      stop();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  const showError = (message: string) => {
    content.innerHTML = `<p class="bot-status warn" data-testid="pair-error">${message}</p><button type="button" class="btn btn-primary" data-again>${PAIR_TEXT.again}</button>`;
    content.querySelector('[data-again]')?.addEventListener('click', () => void run());
  };

  const run = async () => {
    clearInterval(tick);
    content.innerHTML = `<p class="pair-wait">${PAIR_TEXT.waiting}</p>`;
    let start: PairStart;
    try {
      start = await requestPairCode();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Fehler.');
      return;
    }
    if (stopped) return;
    const expiresAt = Date.now() + start.expires_in * 1000;
    content.innerHTML = `
      <p class="pair-intro">${PAIR_TEXT.intro}</p>
      <p class="pair-code" data-testid="pair-code">${start.code}</p>
      <p class="pair-howto">${PAIR_TEXT.howto(start.code)}</p>
      <p class="pair-status"><span class="pair-spinner" aria-hidden="true"></span>${PAIR_TEXT.waiting} <span class="muted" data-left></span></p>`;
    const left = content.querySelector('[data-left]') as HTMLElement;
    const render = () => {
      const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      left.textContent = `· ${PAIR_TEXT.validFor(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)}`;
    };
    render();
    tick = window.setInterval(render, 1000);
    const poll = async () => {
      if (stopped) return;
      if (Date.now() > expiresAt) {
        clearInterval(tick);
        showError(PAIR_TEXT.expired);
        return;
      }
      try {
        const r = await pollPair(start.poll_id);
        if (stopped) return;
        if (r.status === 'approved' && r.token) {
          stop();
          setAppToken(r.token);
          sheet.close();
          toast(PAIR_TEXT.done, 'success');
          onPaired?.();
          return;
        }
        if (r.status === 'expired') {
          clearInterval(tick);
          showError(PAIR_TEXT.expired);
          return;
        }
      } catch {
        /* network hiccup / server waking up – keep polling */
      }
      timer = window.setTimeout(poll, Math.max(2, start.interval) * 1000);
    };
    timer = window.setTimeout(poll, Math.max(2, start.interval) * 1000);
  };
  void run();
}

/** Small helper for status checks: is this device accepted by the server? */
export async function deviceAuthorized(): Promise<boolean | undefined> {
  try {
    const res = await fetchWithTimeout(apiUrl('api/chat/status'), { headers: apiHeaders(false) }, 8000);
    if (!res.ok) return undefined;
    const d = await res.json();
    return d.token_required ? Boolean(d.authorized) : true;
  } catch {
    return undefined;
  }
}
