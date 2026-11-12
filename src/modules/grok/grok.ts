import { escapeHtml } from '../../shared/escape';
import { serverNoteHtml, STATIC_ONLY } from '../../shared/api';
import {
  BOT_MODULES,
  botErrorMessage,
  deleteBotRequest,
  flushBotQueue,
  getBotStatus,
  listBotRequests,
  retryBotRequest,
  sendToGrokBot,
  TASK_MAX,
} from '../../shared/grokbot';
import { icons } from '../../shared/icons';
import { toast } from '../../shared/toast';
import { attachMicButton, micButtonHtml } from '../../shared/voice';
import { routeParams } from '../../router';
import type { BotModule, BotRequest } from '../../types';

const STATUS_LABEL: Record<BotRequest['status'], string> = {
  wartend: 'Wartet',
  gesendet: 'Gesendet',
  fehler: 'Fehler',
};

export async function renderGrok(root: HTMLElement): Promise<() => void> {
  const params = routeParams();
  let draftTask = params.get('task') ?? '';
  let draftModule = (params.get('module') as BotModule) ?? 'allgemein';
  let draftContext = params.get('context') ?? '';
  let statusHtml = `<p class="bot-status muted" data-testid="bot-status">Verbindung wird geprüft…</p>`;

  async function loadStatus(): Promise<void> {
    const status = await getBotStatus();
    if (status.staticOnly) {
      statusHtml = serverNoteHtml('bot-status');
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('[data-testid="bot-form"] input, [data-testid="bot-form"] textarea, [data-testid="bot-form"] button').forEach((el) => (el.disabled = true));
    } else if (!status.reachable) {
      statusHtml = `<p class="bot-status warn" data-testid="bot-status">Der Nova-Server ist nicht erreichbar. Nachrichten werden gespeichert und später gesendet.</p>`;
    } else if (!status.configured) {
      statusHtml = `<p class="bot-status warn" data-testid="bot-status">${escapeHtml(botErrorMessage('not_configured'))}</p>`;
    } else {
      statusHtml = `<p class="bot-status ok" data-testid="bot-status">Verbunden. Grok Bot antwortet dir im Grok-Bot-Chat.${status.tokenRequired ? ' (Zugangscode erforderlich)' : ''}</p>`;
    }
    const el = root.querySelector('[data-testid="bot-status"]');
    if (el) el.outerHTML = statusHtml;
  }

  async function refresh(): Promise<void> {
    const items = await listBotRequests();
    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <div>
            <p class="eyebrow">Nova fragt Grok</p>
            <h1>Grok Bot</h1>
            <p class="subtitle">Schick Grok Bot eine Aufgabe. Die Antwort kommt im Grok-Bot-Chat an, nicht hier in Nova.</p>
          </div>
          <a class="icon-btn on-plum" href="#/einstellungen" aria-label="Einstellungen">${icons.sync}</a>
        </header>

        ${statusHtml}

        <form class="bot-form" data-testid="bot-form">
          <div class="segmented five" role="radiogroup" aria-label="Bereich">
            ${BOT_MODULES.map(
              (m) => `<button type="button" role="radio" aria-checked="${m.value === draftModule}" class="${m.value === draftModule ? 'active' : ''}" data-module="${m.value}">${m.label}</button>`,
            ).join('')}
          </div>
          <div class="composer static">
            <input type="text" name="task" data-testid="bot-input" placeholder="Was soll Grok Bot tun?" maxlength="${TASK_MAX}" autocomplete="off" />
            ${micButtonHtml('bot-mic')}
            <button type="submit" class="btn btn-primary" data-testid="bot-send">Senden</button>
          </div>
          <label class="field">
            <span>Kontext (optional)</span>
            <textarea name="context" rows="2" maxlength="4000" data-testid="bot-context" placeholder="z. B. Details, Liste, Datum"></textarea>
          </label>
        </form>

        <section>
          <div class="section-head">
            <h2 class="section-title">Gesendete Anfragen</h2>
            ${items.some((i) => i.status === 'wartend') ? `<button type="button" class="text-btn" data-action="flush">Jetzt senden</button>` : ''}
          </div>
          <ul class="card-list" data-testid="bot-list">
            ${
              items.length === 0
                ? `<li class="empty-card">Noch nichts gesendet. Probier „ping“ als Verbindungstest.</li>`
                : items
                    .map(
                      (item) => `
              <li class="item-row bot-item status-${item.status}" data-testid="bot-item" data-status="${item.status}">
                <span class="badge badge-${item.status}">${STATUS_LABEL[item.status]}</span>
                <div class="item-copy">
                  <span class="item-title">${escapeHtml(item.task)}</span>
                  <span class="item-meta">${escapeHtml(BOT_MODULES.find((m) => m.value === item.module)?.label ?? item.module)} · ${escapeHtml(new Date(item.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</span>
                  ${item.status === 'gesendet' ? `<span class="item-meta">Antwort im Grok-Bot-Chat.</span>` : ''}
                  ${item.error && item.status !== 'gesendet' ? `<span class="item-meta error-text">${escapeHtml(item.error)}</span>` : ''}
                </div>
                ${item.status !== 'gesendet' ? `<button type="button" class="text-btn" data-action="retry" data-id="${item.id}">Erneut</button>` : '<span></span>'}
                <button type="button" class="icon-btn ghost" data-action="remove" data-id="${item.id}" aria-label="Entfernen">${icons.trash}</button>
              </li>`,
                    )
                    .join('')
            }
          </ul>
        </section>
      </section>
    `;

    const input = root.querySelector('[data-testid="bot-input"]') as HTMLInputElement;
    const context = root.querySelector('[data-testid="bot-context"]') as HTMLTextAreaElement;
    input.value = draftTask;
    context.value = draftContext;
    if (STATIC_ONLY) {
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('[data-testid="bot-form"] input, [data-testid="bot-form"] textarea, [data-testid="bot-form"] button').forEach((el) => (el.disabled = true));
    }
    input.addEventListener('input', () => (draftTask = input.value));
    context.addEventListener('input', () => (draftContext = context.value));

    root.querySelectorAll<HTMLButtonElement>('[data-module]').forEach((b) =>
      b.addEventListener('click', () => {
        draftModule = b.dataset.module as BotModule;
        root.querySelectorAll<HTMLButtonElement>('[data-module]').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-checked', String(x === b));
        });
      }),
    );

    const send = async () => {
      try {
        const result = await sendToGrokBot({ task: input.value, module: draftModule, context: context.value });
        if (result.status === 'gesendet') toast('An Grok Bot gesendet. Die Antwort kommt im Grok-Bot-Chat.', 'success');
        else if (result.status === 'wartend') toast(result.error ?? 'Wird später gesendet.', 'info');
        else toast(result.error ?? 'Fehler beim Senden.', 'error');
        draftTask = '';
        draftContext = '';
        await refresh();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Fehler', 'error');
      }
    };

    root.querySelector('[data-testid="bot-form"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void send();
    });
    attachMicButton({
      button: root.querySelector('[data-testid="bot-mic"]') as HTMLButtonElement,
      input,
      onFinal: (text) => {
        input.value = text;
        draftTask = text;
      },
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="retry"]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = await retryBotRequest(b.dataset.id ?? '');
        if (r?.status === 'gesendet') toast('Gesendet.', 'success');
        else toast(r?.error ?? 'Noch nicht gesendet.', r?.status === 'fehler' ? 'error' : 'info');
        await refresh();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-action="remove"]').forEach((b) =>
      b.addEventListener('click', async () => {
        await deleteBotRequest(b.dataset.id ?? '');
        await refresh();
      }),
    );
    root.querySelector('[data-action="flush"]')?.addEventListener('click', async () => {
      const n = await flushBotQueue();
      toast(n > 0 ? `${n} gesendet.` : 'Noch keine Verbindung.', n > 0 ? 'success' : 'info');
      await refresh();
    });
  }

  const onQueue = () => void refresh();
  window.addEventListener('nova:bot-queue', onQueue);
  await refresh();
  void loadStatus();
  return () => {
    window.removeEventListener('nova:bot-queue', onQueue);
    root.innerHTML = '';
  };
}
