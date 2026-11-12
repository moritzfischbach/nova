// Input validation for POST /api/bot – runtime-agnostic (Node, Workers, Vercel).

export const MODULES = ['todos', 'kalender', 'finanzen', 'ziele', 'allgemein'];
export const LIMITS = { task: 2000, context: 4000, requestId: 80 };

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: { task: string, module: string, context?: string, request_id: string } } | { ok: false, error: string, message: string, field?: string }}
 */
export function validateBotRequest(body, makeId = () => crypto.randomUUID()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body', message: 'Erwarte ein JSON-Objekt.' };
  }
  const b = /** @type {Record<string, unknown>} */ (body);

  if (typeof b.task !== 'string' || !b.task.trim()) {
    return { ok: false, error: 'invalid_task', field: 'task', message: 'Feld "task" fehlt oder ist leer.' };
  }
  const task = b.task.trim();
  if (task.length > LIMITS.task) {
    return { ok: false, error: 'task_too_long', field: 'task', message: `"task" darf höchstens ${LIMITS.task} Zeichen haben.` };
  }

  let module = 'allgemein';
  if (b.module !== undefined && b.module !== null && b.module !== '') {
    if (typeof b.module !== 'string' || !MODULES.includes(b.module)) {
      return { ok: false, error: 'invalid_module', field: 'module', message: `"module" muss eines von ${MODULES.join(', ')} sein.` };
    }
    module = b.module;
  }

  let context;
  if (b.context !== undefined && b.context !== null && b.context !== '') {
    if (typeof b.context !== 'string') {
      return { ok: false, error: 'invalid_context', field: 'context', message: '"context" muss Text sein.' };
    }
    if (b.context.length > LIMITS.context) {
      return { ok: false, error: 'context_too_long', field: 'context', message: `"context" darf höchstens ${LIMITS.context} Zeichen haben.` };
    }
    context = b.context.trim() || undefined;
  }

  let requestId;
  if (b.request_id !== undefined && b.request_id !== null && b.request_id !== '') {
    if (typeof b.request_id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(b.request_id)) {
      return { ok: false, error: 'invalid_request_id', field: 'request_id', message: '"request_id" ist ungültig.' };
    }
    requestId = b.request_id;
  }

  return {
    ok: true,
    value: { task, module, ...(context ? { context } : {}), request_id: requestId ?? `nova-${makeId()}` },
  };
}

/** Webhook URL must be https (http only for localhost, e.g. mock servers). */
export function isValidWebhookUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Constant-time-ish string comparison. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
