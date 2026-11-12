import type { WireMessage } from '../../shared/chatApi';
import type { ChatMessage } from '../../types';

/** Converts the stored conversation into the request format; drops failed replies and unresolved tool calls. */
export function toWire(messages: ChatMessage[]): WireMessage[] {
  const answered = new Set(messages.filter((m) => m.role === 'tool' && m.toolCallId).map((m) => m.toolCallId!));
  const out: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.trim()) out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).filter((c) => answered.has(c.id));
      if (!m.content.trim() && !calls.length) continue;
      out.push({
        role: 'assistant',
        content: m.content.trim() ? m.content : null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
      });
    } else if (m.role === 'tool' && m.toolCallId) {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out.slice(-40);
}

export const DECLINED_RESULT = JSON.stringify({ ok: false, abgelehnt: true, hinweis: 'Die Aktion wurde abgelehnt und nicht ausgeführt.' });
