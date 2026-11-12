// Mock xAI chat-completions server (OpenAI-compatible SSE) for tests.
// Behaviour depends on the last user / tool message.
import { createServer } from 'node:http';

export const MOCK_XAI_KEY = 'test-xai-key-SECRET-987';

function chunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}
function textChunks(id, text, size = 7) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(chunk({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text.slice(i, i + size) }, finish_reason: null }] }));
  return out;
}
/** tool call streamed in several pieces (name first, arguments split) to exercise accumulation */
function toolChunks(id, calls) {
  const out = [chunk({ id, choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })];
  calls.forEach((call, index) => {
    const args = JSON.stringify(call.args);
    out.push(chunk({ id, choices: [{ index: 0, delta: { tool_calls: [{ index, id: `call_${call.name}_${index}`, type: 'function', function: { name: call.name, arguments: '' } }] }, finish_reason: null }] }));
    const mid = Math.floor(args.length / 2);
    out.push(chunk({ id, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(0, mid) } }] }, finish_reason: null }] }));
    out.push(chunk({ id, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(mid) } }] }, finish_reason: null }] }));
  });
  out.push(chunk({ id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
  return out;
}

export function scriptFor(messages) {
  const last = messages[messages.length - 1];
  if (last.role === 'tool') {
    const results = messages.filter((m) => m.role === 'tool').slice(-3).map((m) => m.content).join(' ');
    if (results.includes('abgelehnt')) return { text: 'Alles klar, dann lasse ich das.' };
    if (results.includes('Grok')) return { text: 'Ich habe es an **Grok Bot** weitergegeben – die Antwort kommt in der Grok-App.' };
    return { text: 'Erledigt! ✓ Ich habe es in Nova eingetragen.' };
  }
  const q = String(last.content ?? '').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (q.includes('fehler401')) return { status: 401 };
  if (q.includes('langsam')) return { slow: true, text: 'Langsame Antwort.' };
  if (q.includes('aufgabe')) return { tools: [{ name: 'aufgabe_anlegen', args: { titel: 'Milch kaufen', faellig_am: today } }] };
  if (q.includes('termin')) return { tools: [{ name: 'termin_anlegen', args: { titel: 'Zahnarzt', datum: today, beginn: '15:00', ende: '16:00' } }] };
  if (q.includes('sparziel')) return { tools: [{ name: 'sparziel_einzahlen', args: { ziel: 'Urlaub', betrag: 50 } }] };
  if (q.includes('euro')) return { tools: [{ name: 'finanzeintrag_erfassen', args: { betrag: 12.5, beschreibung: 'Essen', art: 'ausgabe' } }] };
  if (q.includes('grok')) return { tools: [{ name: 'an_grok_bot_weitergeben', args: { aufgabe: 'Recherchiere Flüge nach Lissabon im Mai', bereich: 'allgemein' } }] };
  if (q.includes('beides')) return { tools: [{ name: 'aufgabe_anlegen', args: { titel: 'Koffer packen' } }, { name: 'termin_anlegen', args: { titel: 'Abflug', datum: today, beginn: '18:00' } }] };
  return { text: 'Hallo! Ich bin **Nova**.\n\n- Heute: *2 Aufgaben*\n- `Tipp`: frag mich etwas\n\n<script>alert(1)</script> [Link](javascript:alert(1)) [Doku](https://docs.x.ai)' };
}

export function createMockXai() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const json = body ? JSON.parse(body) : {};
      requests.push({ path: req.url, headers: req.headers, body: json });
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        return res.end('{}');
      }
      if (req.headers.authorization !== `Bearer ${MOCK_XAI_KEY}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'bad key' }));
      }
      const script = scriptFor(json.messages ?? []);
      if (script.status) {
        res.statusCode = script.status;
        return res.end(JSON.stringify({ error: 'upstream says no', detail: 'internal upstream detail' }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const id = `cmpl-${requests.length}`;
      const parts = script.tools ? toolChunks(id, script.tools) : [...textChunks(id, script.text), chunk({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })];
      for (const p of parts) {
        res.write(p);
        await new Promise((r) => setTimeout(r, script.slow ? 120 : 8));
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return {
    requests,
    async listen() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${server.address().port}/v1`;
      return { base, config: { XAI_BASE_URL: base, XAI_API_KEY: MOCK_XAI_KEY } };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
