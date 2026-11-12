import { getAppToken, setAppToken } from '../../shared/api';
import { SERVER_NOTE } from '../../shared/api';
import { escapeHtml } from '../../shared/escape';
import { getBotStatus } from '../../shared/grokbot';
import { toast } from '../../shared/toast';
import { renderPushSettings } from './push-settings';
import { renderBackupSettings } from './backup-settings';
import { deviceAuthorized, openPairingSheet, PAIR_TEXT } from '../../shared/pairing';
import { STATIC_ONLY } from '../../shared/api';

export async function renderSettings(root: HTMLElement): Promise<() => void> {
  const status = await getBotStatus();
  root.innerHTML = `
    <section class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Nova</p>
          <h1>Einstellungen</h1>
          <p class="subtitle">Verbindung zum Nova-Server, Backup, Grok Bot und Mitteilungen.</p>
        </div>
      </header>

      <section class="settings-group" data-pair-section hidden>
        <h2>Dieses Gerät</h2>
        <p class="muted" data-testid="pair-state"></p>
        <button type="button" class="btn btn-primary" data-testid="settings-pair-start" hidden>${PAIR_TEXT.button}</button>
      </section>

      <div data-backup><section class="settings-group" data-testid="backup-settings-loading"><h2>Backup &amp; Sync</h2><p class="muted">Lade …</p></section></div>

      <section class="settings-group">
        <h2>Grok Bot</h2>
        <p class="muted" data-testid="settings-bot-status">${
          status.staticOnly
            ? SERVER_NOTE
            : !status.reachable
            ? 'Nova-Server nicht erreichbar.'
            : status.configured
              ? 'Verbunden – Webhook ist auf dem Server hinterlegt.'
              : 'Server erreichbar, aber Webhook-URL und Schlüssel fehlen noch (.env auf dem Server).'
        }</p>
        <label class="field">
          <span>Zugangscode${status.tokenRequired ? ' (vom Server verlangt)' : ' (optional)'}</span>
          <input type="password" autocomplete="off" data-testid="app-token" value="${escapeHtml(getAppToken())}" placeholder="NOVA_APP_TOKEN" />
        </label>
        <p class="muted">Das ist nicht der Webhook-Schlüssel. Der bleibt immer auf dem Server.</p>
        <button type="button" class="btn btn-secondary" data-action="save-token">Zugangscode speichern</button>
      </section>

      <div data-push></div>
    </section>
  `;
  root.querySelector('[data-action="save-token"]')?.addEventListener('click', () => {
    setAppToken((root.querySelector('[data-testid="app-token"]') as HTMLInputElement).value.trim());
    toast('Zugangscode gespeichert.', 'success');
  });
  const pairSection = root.querySelector('[data-pair-section]') as HTMLElement;
  const pairState = root.querySelector('[data-testid="pair-state"]') as HTMLElement;
  const pairBtn = root.querySelector('[data-testid="settings-pair-start"]') as HTMLButtonElement;
  const refreshPair = async () => {
    if (STATIC_ONLY || !status.reachable || !status.tokenRequired) return;
    const ok = await deviceAuthorized();
    if (ok === undefined) return;
    pairSection.hidden = false;
    pairState.textContent = ok ? 'Mit dem Nova-Server gekoppelt.' : 'Noch nicht mit dem Nova-Server gekoppelt.';
    pairBtn.hidden = ok;
  };
  pairBtn.addEventListener('click', () => openPairingSheet(() => void refreshPair()));
  void refreshPair();
  let disposeBackup: (() => void) | undefined;
  let gone = false;
  void (async () => {
    const paired = STATIC_ONLY || !status.reachable || !status.tokenRequired ? undefined : await deviceAuthorized();
    if (gone) return;
    disposeBackup = await renderBackupSettings(root.querySelector('[data-backup]') as HTMLElement, { paired });
  })();
  await renderPushSettings(root.querySelector('[data-push]') as HTMLElement);
  return () => {
    gone = true;
    disposeBackup?.();
    root.innerHTML = '';
  };
}
