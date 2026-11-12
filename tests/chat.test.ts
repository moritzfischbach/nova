import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/modules/chat/markdown';
import { parseSseFrames } from '../src/shared/chatApi';
import { describeToolCall, parseArgs } from '../src/modules/chat/tools';
import { formatContext, type ContextData } from '../src/modules/chat/context';
import { toWire, DECLINED_RESULT } from '../src/modules/chat/wire';
import type { ChatMessage } from '../src/types';

describe('Markdown (sicher)', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('Hallo <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
  it('allows only http(s)/mailto links', () => {
    expect(renderMarkdown('[gut](https://x.ai)')).toContain('href="https://x.ai"');
    const bad = renderMarkdown('[böse](javascript:alert(1))');
    expect(bad).not.toContain('href');
    expect(bad).toContain('böse');
  });
  it('renders bold, lists, code', () => {
    const html = renderMarkdown('**Fett** und *kursiv*\n\n- eins\n- zwei\n\n`code <b>`');
    expect(html).toContain('<strong>Fett</strong>');
    expect(html).toContain('<em>kursiv</em>');
    expect(html).toMatch(/<ul>.*<li>eins<\/li>.*<li>zwei<\/li>.*<\/ul>/s);
    expect(html).toContain('<code>code &lt;b&gt;</code>');
  });
  it('does not break attribute quoting', () => {
    const html = renderMarkdown('[x](https://a.de/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"\s*onmouseover=/);
  });
});

describe('SSE-Parser', () => {
  it('splits frames and keeps the rest', () => {
    const got: string[] = [];
    const rest = parseSseFrames('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"', (d) => got.push(d));
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });
});

describe('Tool-Beschreibungen', () => {
  it('parses broken JSON safely', () => {
    expect(parseArgs({ arguments: '{kaputt' })).toEqual({});
  });
  it('describes actions in German', () => {
    expect(describeToolCall({ name: 'aufgabe_anlegen', arguments: '{"titel":"Milch kaufen"}' })).toContain('Milch kaufen');
    expect(describeToolCall({ name: 'termin_anlegen', arguments: '{"titel":"Zahnarzt","datum":"2026-11-20","beginn":"15:00","ende":"16:00"}' })).toContain('15:00–16:00');
    expect(describeToolCall({ name: 'finanzeintrag_erfassen', arguments: '{"betrag":"12,5","beschreibung":"Essen"}' })).toMatch(/Ausgabe 12,50/);
    expect(describeToolCall({ name: 'sparziel_einzahlen', arguments: '{"ziel":"Urlaub","betrag":50}' })).toContain('Sparziel „Urlaub“');
  });
});

describe('Kontext', () => {
  it('summarises compactly', () => {
    const d = {
      today: '2026-11-12',
      todos: [
        { id: '1', title: 'Steuer', done: false, listId: 'l', dueDate: '2026-11-13' },
        { id: '2', title: 'Erledigt', done: true, listId: 'l' },
      ],
      lists: [{ id: 'l', name: 'Privat' }],
      instances: [{ date: '2026-11-14', event: { title: 'Kino', allDay: false, startTime: '20:00' } }, { date: '2026-12-30', event: { title: 'Fern', allDay: true } }],
      month: { label: 'November 2026', expenses: 120, income: 2000, byCategory: [{ name: 'Essen', amount: 80 }] },
      goals: [{ id: 'g', kind: 'spar', title: 'Urlaub', status: 'offen', targetAmount: 1000, deposits: [{ amount: 100 }] }],
    } as unknown as ContextData;
    const text = formatContext(d);
    expect(text).toContain('Offene Aufgaben (1)');
    expect(text).toContain('Steuer (fällig 2026-11-13) [Privat]');
    expect(text).toContain('Kino');
    expect(text).not.toContain('Fern');
    expect(text).toContain('Essen');
    expect(text).toContain('Sparziel „Urlaub“');
    expect(text.length).toBeLessThanOrEqual(2400);
  });
});

describe('Wire-Format', () => {
  const m = (o: Partial<ChatMessage>): ChatMessage => ({ id: Math.random().toString(), role: 'user', content: '', createdAt: '', ...o });
  it('keeps answered tool calls and drops failures', () => {
    const wire = toWire([
      m({ content: 'Leg Milch an' }),
      m({ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'aufgabe_anlegen', arguments: '{}', status: 'ausgefuehrt' }, { id: 'c2', name: 'aufgabe_anlegen', arguments: '{}', status: 'offen' }] }),
      m({ role: 'tool', toolCallId: 'c1', content: '{"ok":true}' }),
      m({ role: 'assistant', content: '', error: 'kaputt' }),
      m({ content: 'Danke' }),
    ]);
    expect(wire.map((w) => w.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(wire[1].tool_calls?.map((c) => c.id)).toEqual(['c1']);
    expect(wire[1].content).toBeNull();
    expect(JSON.parse(DECLINED_RESULT).abgelehnt).toBe(true);
  });
});
