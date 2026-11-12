import logoSvg from '../../assets/logo.svg?raw';
import { getAppToken } from '../../shared/api';
import { openPairingSheet, PAIR_TEXT } from '../../shared/pairing';
import { ChatError, getChatStatus, streamChat, type ChatStatus } from '../../shared/chatApi';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { attachMicButton, micButtonHtml } from '../../shared/voice';
import type { ChatConversation, ChatMessage, ChatToolCall, ChatToolName } from '../../types';
import { buildContext, contextSharingEnabled, setContextSharing } from './context';
import { renderMarkdown } from './markdown';
import { ACTIVE_KEY, deleteConversation, getConversation, listConversations, message, newConversation, saveConversation } from './repo';
import { describeToolCall, executeToolCall, TOOL_LABELS } from './tools';
import { DECLINED_RESULT, toWire } from './wire';

export const SUGGESTIONS: { label: string; text: string; send: boolean }[] = [
  { label: 'Was steht heute an?', text: 'Was steht heute an?', send: true },
  { label: 'Plane meine Woche', text: 'Hilf mir, meine Woche zu planen.', send: true },
  { label: 'Wie läuft mein Budget?', text: 'Wie sieht mein Budget diesen Monat aus?', send: true },
  { label: 'Aufgabe anlegen …', text: 'Leg eine Aufgabe an: ', send: false },
  { label: 'Termin eintragen …', text: 'Trag einen Termin ein: ', send: false },
  { label: 'Grok Bot fragen …', text: 'Gib an Grok Bot weiter: ', send: false },
];

const STATUS_TEXT: Record<string, string> = {
  ausgefuehrt: 'Erledigt',
  abgelehnt: 'Verworfen',
  fehler: 'Fehlgeschlagen',
  offen: 'Bestätigen?',
};

function statusNote(status: ChatStatus): string {
  if (status.staticOnly) return 'Nova Chat braucht den Nova-Server und einen xAI-Schlüssel, kommt nach der Server-Einrichtung.';
  if (!status.reachable) return 'Der Nova-Server ist gerade nicht erreichbar. Nach einer Pause braucht er bis zu einer Minute zum Aufwachen – Nova versucht es automatisch weiter.';
  if (!status.configured) return 'Auf dem Nova-Server fehlt noch der xAI-Schlüssel (XAI_API_KEY).';
  if (status.tokenRequired && !status.authorized) return getAppToken() ? 'Dieses Gerät ist nicht mehr mit dem Nova-Server gekoppelt. Bitte neu koppeln.' : 'Dieses Gerät ist noch nicht mit dem Nova-Server gekoppelt.';
  return '';
}

const AUTO_SEND_KEY = 'nova.chatAutoSend';

export async function renderChat(root: HTMLElement): Promise<() => void> {
  let disposed = false;
  let conv: ChatConversation = (await (async () => {
    const id = localStorage.getItem(ACTIVE_KEY);
    return (id && (await getConversation(id))) || (await listConversations())[0];
  })()) ?? newConversation();
  let status: ChatStatus = { reachable: false, configured: false };
  let busy = false;
  let abort: AbortController | undefined;
  let streamingId: string | undefined;

  root.innerHTML = `
    <section class="chat-page" data-testid="chat">
      <header class="chat-header">
        <button type="button" class="icon-btn" data-action="history" aria-label="Verläufe" data-testid="chat-history">${icons.list}</button>
        <div class="chat-title">
          <span class="brand-mark chat-mark">${logoSvg}</span>
          <div>
            <h1>Nova</h1>
            <p class="chat-sub" data-testid="chat-sub">Deine Assistentin</p>
          </div>
        </div>
        <button type="button" class="icon-btn" data-action="new" aria-label="Neuer Chat" data-testid="chat-new">${icons.plus}</button>
      </header>
      <div data-testid="chat-status" class="chat-status" hidden></div>
      <div class="chat-log" data-testid="chat-log" aria-live="polite"></div>
      <form class="chat-composer" data-testid="chat-form">
        <button type="button" class="ctx-toggle" data-action="ctx" data-testid="chat-context" aria-pressed="true"></button>
        <div class="chat-input-row">
          <textarea rows="1" maxlength="4000" placeholder="Schreib Nova …" data-testid="chat-input" aria-label="Nachricht an Nova"></textarea>
          ${micButtonHtml('chat-mic')}
          <button type="submit" class="send-btn" data-testid="chat-send" aria-label="Senden">${icons.send}</button>
        </div>
      </form>
    </section>`;

  const log = root.querySelector('.chat-log') as HTMLElement;
  const form = root.querySelector('[data-testid="chat-form"]') as HTMLFormElement;
  const input = root.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement;
  const sendBtn = root.querySelector('[data-testid="chat-send"]') as HTMLButtonElement;
  const statusEl = root.querySelector('[data-testid="chat-status"]') as HTMLElement;
  const ctxBtn = root.querySelector('[data-action="ctx"]') as HTMLButtonElement;
  const sub = root.querySelector('[data-testid="chat-sub"]') as HTMLElement;
  // The view animates with transforms (which would trap position:fixed), so the composer lives on the shell.
  (root.closest('.shell') ?? document.body).append(form);
  const scroller = (root.closest('.view') as HTMLElement | null) ?? document.scrollingElement ?? document.documentElement;

  const canSend = () => !busy && status.reachable && status.configured && !(status.tokenRequired && !status.authorized);

  const updateControls = () => {
    const enabled = canSend();
    const streaming = busy && Boolean(abort);
    sendBtn.disabled = streaming ? false : Boolean(status.staticOnly) || !input.value.trim();
    sendBtn.classList.toggle('stop', streaming);
    sendBtn.innerHTML = streaming ? icons.stop : icons.send;
    sendBtn.setAttribute('aria-label', streaming ? 'Antwort stoppen' : 'Senden');
    input.disabled = Boolean(status.staticOnly);
    form.classList.toggle('disabled', !enabled && !busy);
    root.querySelectorAll<HTMLButtonElement>('.suggestion').forEach((b) => (b.disabled = !enabled));
    const on = contextSharingEnabled();
    ctxBtn.setAttribute('aria-pressed', String(on));
    ctxBtn.innerHTML = `<span class="dot"></span>${on ? 'Nova-Daten teilen: an' : 'Nova-Daten teilen: aus'}`;
  };

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const scrollDown = (force = false) => {
    if (force || nearBottom()) scroller.scrollTo({ top: scroller.scrollHeight, behavior: force ? 'auto' : 'smooth' });
  };

  const toolChip = (msg: ChatMessage, call: ChatToolCall) => `
    <div class="tool-chip status-${call.status}" data-testid="tool-chip" data-status="${call.status}" data-tool="${call.name}">
      <div class="tool-head"><span class="tool-name">${escapeHtml(TOOL_LABELS[call.name as ChatToolName] ?? call.name)}</span><span class="tool-state">${STATUS_TEXT[call.status]}</span></div>
      <p class="tool-desc">${escapeHtml(call.status === 'offen' || !call.summary ? describeToolCall(call) : call.summary)}</p>
      ${
        call.status === 'offen'
          ? `<div class="tool-actions"><button type="button" class="btn btn-ghost" data-decline="${msg.id}|${call.id}" data-testid="tool-decline">Verwerfen</button><button type="button" class="btn btn-primary" data-confirm="${msg.id}|${call.id}" data-testid="tool-confirm">${call.name === 'an_grok_bot_weitergeben' ? 'Senden' : 'Ausführen'}</button></div>`
          : call.link && call.status === 'ausgefuehrt'
            ? `<a class="tool-link" href="${escapeHtml(call.link)}">Öffnen →</a>`
            : ''
      }
    </div>`;

  const bubble = (m: ChatMessage) => {
    if (m.role === 'tool') return '';
    if (m.role === 'user') return `<div class="msg user" data-testid="msg-user"><div class="bubble">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div></div>`;
    const streaming = m.id === streamingId;
    const body = m.content ? renderMarkdown(m.content) : streaming ? '<span class="typing"><i></i><i></i><i></i></span>' : '';
    return `
      <div class="msg assistant${streaming ? ' streaming' : ''}" data-testid="msg-assistant" data-id="${m.id}">
        ${body ? `<div class="bubble md" data-testid="msg-text">${body}</div>` : ''}
        ${(m.toolCalls ?? []).map((c) => toolChip(m, c)).join('')}
        ${m.error ? `<div class="msg-error" data-testid="msg-error" data-code="${escapeHtml(m.errorCode ?? '')}">${escapeHtml(m.error)} ${m.errorCode === 'unauthorized' ? `<button type="button" class="text-btn" data-pair data-testid="error-pair">${PAIR_TEXT.button}</button>` : ''}<button type="button" class="text-btn" data-retry="${m.id}" data-testid="chat-retry">Erneut versuchen</button></div>` : ''}
      </div>`;
  };

  const renderLog = () => {
    const visible = conv.messages.filter((m) => m.role !== 'tool');
    if (!visible.length) {
      log.innerHTML = `
        <div class="chat-empty">
          <span class="brand-mark chat-hero-mark">${logoSvg}</span>
          <h2>Wie kann ich dir helfen?</h2>
          <p>Frag mich nach deinem Tag, lass mich Aufgaben, Termine oder Ausgaben eintragen – oder gib etwas an Grok Bot weiter.</p>
          <div class="suggestions" data-testid="chat-suggestions">
            ${SUGGESTIONS.map((s, i) => `<button type="button" class="suggestion" data-suggest="${i}">${escapeHtml(s.label)}</button>`).join('')}
          </div>
        </div>`;
    } else {
      log.innerHTML = visible.map(bubble).join('');
    }
    updateControls();
  };

  let raf = 0;
  const renderStreaming = (m: ChatMessage) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = log.querySelector(`[data-id="${m.id}"]`);
      if (el) el.outerHTML = bubble(m);
      else renderLog();
      scrollDown();
    });
  };

  const persist = async () => {
    conv = await saveConversation(conv);
    localStorage.setItem(ACTIVE_KEY, conv.id);
  };

  async function runModel(round = 0): Promise<void> {
    const assistant = message('assistant', '');
    conv.messages.push(assistant);
    streamingId = assistant.id;
    busy = true;
    renderLog();
    scrollDown(true);
    abort = new AbortController();
    try {
      const context = contextSharingEnabled() ? await buildContext().catch(() => '') : '';
      await streamChat(
        { messages: toWire(conv.messages), context, conversation_id: conv.id },
        {
          onStart: (model) => {
            assistant.model = model;
            sub.textContent = model ? `Grok · ${model}` : 'Deine Assistentin';
          },
          onDelta: (text) => {
            assistant.content += text;
            renderStreaming(assistant);
          },
          onToolCalls: (calls) => {
            assistant.toolCalls = calls.map((c) => ({ id: c.id, name: c.name as ChatToolName, arguments: c.arguments, status: 'offen' as const }));
          },
        },
        abort.signal,
      );
      if (!assistant.content && !assistant.toolCalls?.length) assistant.error = 'Keine Antwort erhalten.';
    } catch (err) {
      if (!(err instanceof ChatError && err.code === 'aborted')) {
        assistant.error = err instanceof Error ? err.message : 'Fehler.';
        assistant.errorCode = err instanceof ChatError ? err.code : 'unknown';
        if (assistant.errorCode === 'unauthorized') void refreshStatus();
      }
    } finally {
      cancelAnimationFrame(raf);
      raf = 0;
      streamingId = undefined;
      busy = false;
      abort = undefined;
    }
    if (disposed) return;
    await persist();
    renderLog();
    scrollDown(true);
    void round;
  }

  /** Before a new user message: unresolved tool calls count as declined (keeps the protocol valid). */
  const closeOpenCalls = () => {
    for (const m of conv.messages) {
      for (const c of m.toolCalls ?? []) {
        if (c.status === 'offen') {
          c.status = 'abgelehnt';
          c.result = DECLINED_RESULT;
          conv.messages.push(message('tool', DECLINED_RESULT, { toolCallId: c.id }));
        }
      }
    }
  };

  async function send(text: string): Promise<void> {
    const value = text.trim();
    if (!value) return;
    if (busy) {
      toast('Nova antwortet noch – einen Moment, dann kannst du weiterschreiben.', 'info');
      return;
    }
    if (!canSend()) {
      toast(statusNote(status) || 'Senden ist gerade nicht möglich.', 'error');
      if (!status.reachable) void refreshStatus();
      return;
    }
    closeOpenCalls();
    conv.messages.push(message('user', value));
    input.value = '';
    autosize();
    await persist();
    await runModel();
  }

  async function resolveCall(msgId: string, callId: string, accept: boolean) {
    const msg = conv.messages.find((m) => m.id === msgId);
    const call = msg?.toolCalls?.find((c) => c.id === callId);
    if (!msg || !call || call.status !== 'offen' || busy) return;
    if (accept) {
      busy = true;
      const outcome = await executeToolCall(call);
      busy = false;
      call.status = outcome.ok ? 'ausgefuehrt' : 'fehler';
      call.summary = outcome.summary;
      call.link = outcome.link;
      call.result = outcome.result;
      if (outcome.ok) toast(outcome.summary, 'success');
    } else {
      call.status = 'abgelehnt';
      call.result = DECLINED_RESULT;
    }
    conv.messages.push(message('tool', call.result!, { toolCallId: call.id }));
    await persist();
    renderLog();
    const pending = (msg.toolCalls ?? []).some((c) => c.status === 'offen');
    const followUps = conv.messages.slice(conv.messages.indexOf(msg)).filter((m) => m.role === 'assistant').length;
    if (!pending && followUps <= 4 && canSend()) await runModel();
  }

  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    updateControls();
  };

  // events
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy && abort) {
      abort.abort();
      return;
    }
    void send(input.value);
  });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault();
      void send(input.value);
    }
  });
  ctxBtn.addEventListener('click', () => {
    setContextSharing(!contextSharingEnabled());
    updateControls();
    toast(contextSharingEnabled() ? 'Nova teilt jetzt eine kurze Zusammenfassung deiner Daten mit dem Chat.' : 'Der Chat bekommt keine Nova-Daten mehr.', 'info');
  });
  log.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sug = t.closest<HTMLButtonElement>('[data-suggest]');
    if (sug) {
      const s = SUGGESTIONS[Number(sug.dataset.suggest)];
      if (s.send) void send(s.text);
      else {
        input.value = s.text;
        autosize();
        input.focus();
      }
      return;
    }
    const confirm = t.closest<HTMLButtonElement>('[data-confirm]');
    const decline = t.closest<HTMLButtonElement>('[data-decline]');
    if (confirm || decline) {
      const [m, c] = (confirm ?? decline)!.dataset[confirm ? 'confirm' : 'decline']!.split('|');
      void resolveCall(m, c, Boolean(confirm));
      return;
    }
    if (t.closest('[data-pair]')) {
      openPairingSheet(() => void refreshStatus());
      return;
    }
    const retry = t.closest<HTMLButtonElement>('[data-retry]');
    if (retry && !busy) {
      conv.messages = conv.messages.filter((m) => m.id !== retry.dataset.retry);
      void runModel();
    }
  });
  attachMicButton({
    button: form.querySelector('[data-testid="chat-mic"]') as HTMLButtonElement,
    input: input as unknown as HTMLInputElement,
    onFinal: (text) => send(text),
  });

  root.querySelector('[data-action="new"]')?.addEventListener('click', async () => {
    if (busy) abort?.abort();
    conv = newConversation();
    localStorage.removeItem(ACTIVE_KEY);
    renderLog();
    input.focus();
  });

  root.querySelector('[data-action="history"]')?.addEventListener('click', async () => {
    const all = await listConversations();
    const content = document.createElement('div');
    content.className = 'chat-history';
    content.innerHTML = `
      <ul class="card-list" data-testid="chat-conversations">
        ${
          all.length
            ? all
                .map(
                  (c) => `<li class="item-row conv-row${c.id === conv.id ? ' active' : ''}" data-testid="chat-conversation">
                <button type="button" class="conv-open item-copy" data-open="${c.id}"><span class="item-title">${escapeHtml(c.title)}</span><span class="item-meta">${escapeHtml(new Date(c.updatedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))} · ${c.messages.filter((m) => m.role !== 'tool').length} Nachrichten</span></button>
                <button type="button" class="icon-btn ghost" data-del="${c.id}" aria-label="Chat löschen">${icons.trash}</button>
              </li>`,
                )
                .join('')
            : '<li class="empty-card">Noch keine Chats.</li>'
        }
      </ul>`;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `<button type="button" class="btn btn-danger" data-clear data-testid="chat-clear">Diesen Chat leeren</button><button type="button" class="btn btn-primary" data-new>Neuer Chat</button>`;
    const sheet = openSheet({ title: 'Deine Chats', content, footer });
    content.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const open = t.closest<HTMLElement>('[data-open]');
      const del = t.closest<HTMLElement>('[data-del]');
      if (open) {
        const next = await getConversation(open.dataset.open!);
        if (next) {
          conv = next;
          localStorage.setItem(ACTIVE_KEY, conv.id);
          renderLog();
          scrollDown(true);
        }
        sheet.close();
      } else if (del) {
        await deleteConversation(del.dataset.del!);
        del.closest('li')?.remove();
        if (del.dataset.del === conv.id) {
          conv = newConversation();
          localStorage.removeItem(ACTIVE_KEY);
          renderLog();
        }
      }
    });
    footer.querySelector('[data-clear]')?.addEventListener('click', async () => {
      if (busy) abort?.abort();
      conv.messages = [];
      conv.title = 'Neuer Chat';
      await persist();
      renderLog();
      sheet.close();
      toast('Chat geleert.', 'info');
    });
    footer.querySelector('[data-new]')?.addEventListener('click', () => {
      conv = newConversation();
      localStorage.removeItem(ACTIVE_KEY);
      renderLog();
      sheet.close();
    });
  });

  renderLog();
  scrollDown(true);
  let retryTimer = 0;
  // eslint-disable-next-line prefer-const
  const refreshStatus = async () => {
    clearTimeout(retryTimer);
    if (!status.reachable && !statusEl.innerHTML) {
      statusEl.hidden = false;
      statusEl.innerHTML = `<p class="bot-status server-note" data-testid="chat-connecting">Verbinde mit dem Nova-Server …</p>`;
    }
    status = await getChatStatus();
    if (disposed) return;
    if (!status.reachable && !status.staticOnly) retryTimer = window.setTimeout(() => void refreshStatus(), 10000);
    const note = statusNote(status);
    const needsPair = status.reachable && status.tokenRequired && !status.authorized;
    statusEl.hidden = !note;
    statusEl.innerHTML = note
      ? `<div class="bot-status warn server-note chat-note-box" data-testid="chat-note"><span>${escapeHtml(note)}</span>${
          needsPair ? `<button type="button" class="btn btn-primary pair-btn" data-testid="pair-start">${PAIR_TEXT.button}</button>` : ''
        }</div>`
      : '';
    statusEl.querySelector('[data-testid="pair-start"]')?.addEventListener('click', () => openPairingSheet(() => void refreshStatus()));
    if (status.model) sub.textContent = `Grok · ${status.model}`;
    updateControls();
    maybeAutoSend();
  };
  // "Tag planen mit Nova" (Morgenplaner) hands over a prompt that is sent once the server is ready.
  let autoSend = sessionStorage.getItem(AUTO_SEND_KEY);
  sessionStorage.removeItem(AUTO_SEND_KEY);
  if (autoSend) {
    conv = newConversation();
    localStorage.removeItem(ACTIVE_KEY);
    renderLog();
    input.value = autoSend;
    autosize();
  }
  function maybeAutoSend(): void {
    if (!autoSend || disposed) return;
    if (canSend()) {
      const text = autoSend;
      autoSend = null;
      void send(text);
    } else if (status.reachable || status.staticOnly) {
      autoSend = null; // stays in the input; the note above explains why it cannot be sent
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!status.reachable || (status.tokenRequired && !status.authorized))) void refreshStatus();
  };
  document.addEventListener('visibilitychange', onVisible);
  await refreshStatus();
  if (disposed) return () => undefined;
  const pre = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q');
  if (pre) {
    input.value = pre;
    autosize();
  }

  return () => {
    disposed = true;
    clearTimeout(retryTimer);
    document.removeEventListener('visibilitychange', onVisible);
    abort?.abort();
    form.remove();
    root.innerHTML = '';
  };
}
