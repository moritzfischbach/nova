import { setAppToken } from './api';

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
