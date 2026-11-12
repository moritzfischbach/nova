import { getAppToken, setAppToken } from '../../shared/api';
import { SERVER_NOTE } from '../../shared/api';
import { escapeHtml } from '../../shared/escape';
import { getBotStatus } from '../../shared/grokbot';
import { toast } from '../../shared/toast';
import { renderPushSettings } from './push-settings';

export async function renderSettings(root: HTMLElement): Promise<() => void> {
  const status = await getBotStatus();
  root.innerHTML = `
    <section class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Nova</p>
          <h1>Einstellungen</h1>
          <p class="subtitle">Verbindung zum Nova-Server, Grok Bot und Mitteilungen.</p>
        </div>
      </header>

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
  await renderPushSettings(root.querySelector('[data-push]') as HTMLElement);
  return () => {
    root.innerHTML = '';
  };
}
