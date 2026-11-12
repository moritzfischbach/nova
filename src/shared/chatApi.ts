/** Client for Nova's /api/chat (xAI proxy). The xAI key exists only on the server. */
import { apiHeaders, apiUrl, fetchWithTimeout, STATIC_ONLY } from './api';

export interface ChatStatus {
  staticOnly?: boolean;
  reachable: boolean;
  configured: boolean;
  model?: string;
  tokenRequired?: boolean;
}

export async function getChatStatus(): Promise<ChatStatus> {
  if (STATIC_ONLY) return { staticOnly: true, reachable: false, configured: false };
  try {
    const res = await fetchWithTimeout(apiUrl('api/chat/status'), { headers: apiHeaders(false) }, 6000);
    if (!res.ok) return { reachable: false, configured: false };
    const data = await res.json();
    return { reachable: true, configured: Boolean(data.configured), model: data.model, tokenRequired: Boolean(data.token_required) };
  } catch {
    return { reachable: false, configured: false };
  }
}

export interface WireMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface StreamHandlers {
  onStart?: (model: string) => void;
  onDelta: (text: string) => void;
  onToolCalls?: (calls: { id: string; name: string; arguments: string }[]) => void;
}

export class ChatError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Parses "data: {...}\n\n" frames; returns leftover buffer. */
export function parseSseFrames(buffer: string, onData: (data: string) => void): string {
  let rest = buffer;
  let idx: number;
  while ((idx = rest.search(/\r?\n\r?\n/)) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx).replace(/^\r?\n\r?\n/, '');
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data) onData(data);
  }
  return rest;
}

export async function streamChat(
  body: { messages: WireMessage[]; context?: string; conversation_id?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<{ finishReason: string }> {
  if (STATIC_ONLY) throw new ChatError('static', 'Braucht den Nova-Server und einen xAI-Schlüssel, kommt nach der Server-Einrichtung.');
  let res: Response;
  try {
    res = await fetch(apiUrl('api/chat'), { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new ChatError('aborted', 'Abgebrochen.');
    throw new ChatError('offline', navigator.onLine === false ? 'Keine Verbindung. Bitte später noch einmal senden.' : 'Der Nova-Server ist nicht erreichbar.');
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ChatError(data.error ?? `http_${res.status}`, data.message ?? `Fehler ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason = 'stop';
  let failure: ChatError | undefined;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw new ChatError('aborted', 'Abgebrochen.');
      throw new ChatError('stream_error', 'Die Verbindung ist abgebrochen.');
    }
    if (chunk.done) break;
    buffer = parseSseFrames(buffer + decoder.decode(chunk.value, { stream: true }), (data) => {
      let ev: { type: string; text?: string; model?: string; calls?: { id: string; name: string; arguments: string }[]; finish_reason?: string; error?: string; message?: string };
      try {
        ev = JSON.parse(data);
      } catch {
        return;
      }
      if (ev.type === 'start') handlers.onStart?.(ev.model ?? '');
      else if (ev.type === 'delta' && ev.text) handlers.onDelta(ev.text);
      else if (ev.type === 'tool_calls' && ev.calls) handlers.onToolCalls?.(ev.calls);
      else if (ev.type === 'done') finishReason = ev.finish_reason ?? 'stop';
      else if (ev.type === 'error') failure = new ChatError(ev.error ?? 'stream_error', ev.message ?? 'Fehler.');
    });
  }
  if (failure) throw failure;
  return { finishReason };
}
