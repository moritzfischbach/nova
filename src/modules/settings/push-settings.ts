import { SERVER_NOTE } from '../../shared/api';
import { toast } from '../../shared/toast';
import { disablePush, enablePush, getPushServerStatus, isIOS, pushEnabledLocally, pushSupport, sendTestPush } from '../../shared/reminders';

export async function renderPushSettings(host: HTMLElement): Promise<void> {
  const support = pushSupport();
  const server = await getPushServerStatus();
  const enabled = pushEnabledLocally() && typeof Notification !== 'undefined' && Notification.permission === 'granted';

  let explainer = '';
  if (support === 'ios-not-installed') {
    explainer = `
      <div class="hint-card" data-testid="push-ios-hint">
        <p><strong>Auf dem iPhone erst installieren</strong></p>
        <p>Mitteilungen gibt es auf dem iPhone nur für Apps auf dem Home-Bildschirm (ab iOS 16.4):</p>
        <p>1. Nova in Safari über die HTTPS-Adresse öffnen · 2. Teilen → „Zum Home-Bildschirm“ · 3. Nova vom Home-Bildschirm starten · 4. Hier „Mitteilungen aktivieren“ tippen und erlauben.</p>
      </div>`;
  } else if (support === 'insecure') {
    explainer = `<div class="hint-card" data-testid="push-insecure-hint"><p>Mitteilungen brauchen eine sichere HTTPS-Verbindung (oder localhost).</p></div>`;
  } else if (support === 'unsupported') {
    explainer = `<div class="hint-card" data-testid="push-unsupported-hint"><p>Dieser Browser unterstützt keine Web-Push-Mitteilungen.</p></div>`;
  }

  host.innerHTML = `
    <section class="settings-group" data-testid="push-settings">
      <h2>Mitteilungen</h2>
      <p class="muted" data-testid="push-status">${
        server.staticOnly
          ? SERVER_NOTE
          : !server.reachable
          ? 'Nova-Server nicht erreichbar.'
          : !server.configured
            ? 'Auf dem Server noch nicht eingerichtet (VAPID-Schlüssel fehlen: npm run gen:vapid).'
            : enabled
              ? 'Aktiv auf diesem Gerät. Erinnerungen für Termine, fällige Aufgaben und Zieldaten.'
              : 'Erinnerungen an Termine (z. B. 10 Min. vorher), fällige Aufgaben und Zieldaten.'
      }</p>
      ${explainer}
      ${
        support === 'ok' && server.configured
          ? enabled
            ? `<div class="row-actions"><button type="button" class="btn btn-secondary" data-test data-testid="push-test">Test senden</button><button type="button" class="btn btn-ghost" data-off>Ausschalten</button></div>`
            : `<button type="button" class="btn btn-primary" data-on data-testid="push-enable">Mitteilungen aktivieren</button>`
          : ''
      }
      ${isIOS() ? '<p class="muted">Hinweis: Auf dem iPhone kommen Mitteilungen nur, wenn Nova vom Home-Bildschirm gestartet wurde und Mitteilungen in den iOS-Einstellungen erlaubt sind.</p>' : ''}
    </section>`;

  host.querySelector('[data-on]')?.addEventListener('click', async () => {
    try {
      await enablePush();
      toast('Mitteilungen aktiviert.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'error');
    }
    await renderPushSettings(host);
  });
  host.querySelector('[data-off]')?.addEventListener('click', async () => {
    await disablePush();
    toast('Mitteilungen ausgeschaltet.', 'info');
    await renderPushSettings(host);
  });
  host.querySelector('[data-test]')?.addEventListener('click', async () => {
    try {
      await sendTestPush();
      toast('Test-Mitteilung gesendet.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'error');
    }
  });
}
