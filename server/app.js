// Portable Hono app: Node (server/node.js), Cloudflare Workers (server/worker.js), Vercel (Hono adapter).
import { Hono } from 'hono';
import { isValidWebhookUrl, safeEqual, validateBotRequest } from './validate.js';
import { registerCalendarRoutes } from './calendar.js';
import { registerPushRoutes } from './push.js';
import { registerChatRoutes } from './chat.js';
import { registerPairRoutes } from './pair.js';
import { hasAppAccess } from './auth.js';
import { memoryStore } from './store.js';

/**
 * @typedef {{
 *   GROKBOT_WEBHOOK_URL?: string,
 *   GROKBOT_WEBHOOK_KEY?: string,
 *   NOVA_APP_TOKEN?: string,
 *   ALLOWED_ORIGINS?: string,
 *   RATE_LIMIT_PER_MINUTE?: string | number,
 *   UPSTREAM_TIMEOUT_MS?: string | number,
 * }} BotConfig
 */

export function createRateLimiter(perMinute) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return (key, now = Date.now()) => {
    const windowStart = now - 60_000;
    const list = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (list.length >= perMinute) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

/**
 * @param {{ getConfig: (c: any) => BotConfig, log?: (msg: string) => void, fetchImpl?: typeof fetch, store?: import('./store.js').Store, push?: any }} options
 */
export function createApp({ getConfig, log = () => {}, fetchImpl, store = memoryStore(), push }) {
  const app = new Hono();
  /** @type {Map<number, ReturnType<typeof createRateLimiter>>} */
  const limiters = new Map();

  const configured = (cfg) => Boolean(cfg.GROKBOT_WEBHOOK_KEY && isValidWebhookUrl(cfg.GROKBOT_WEBHOOK_URL));

  const allowedOrigins = (cfg, requestUrl) => {
    const list = String(cfg.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);
    list.push(new URL(requestUrl).origin);
    return list;
  };

  // CORS + origin allowlist for /api/*
  app.use('/api/*', async (c, next) => {
    const cfg = getConfig(c);
    const origin = c.req.header('origin');
    const allowed = allowedOrigins(cfg, c.req.url);
    if (origin && !allowed.includes(origin)) {
      return c.json({ ok: false, error: 'forbidden_origin', message: 'Diese Herkunft ist nicht erlaubt.' }, 403);
    }
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', 'Content-Type, X-Nova-Token');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      c.header('Access-Control-Max-Age', '600');
    }
    c.header('Cache-Control', 'no-store');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // health check for hosting (Render etc.) – no secrets, no config details
  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/bot/status', (c) => {
    const cfg = getConfig(c);
    return c.json({
      ok: true,
      configured: configured(cfg),
      token_required: Boolean(cfg.NOVA_APP_TOKEN),
    });
  });

  app.post('/api/bot', async (c) => {
    const cfg = getConfig(c);

    if (!(await hasAppAccess(c, cfg))) {
      return c.json({ ok: false, error: 'unauthorized', message: 'Zugangscode fehlt oder ist falsch.' }, 401);
    }

    const perMinute = Math.max(1, Number(cfg.RATE_LIMIT_PER_MINUTE ?? 10) || 10);
    if (!limiters.has(perMinute)) limiters.set(perMinute, createRateLimiter(perMinute));
    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
      c.env?.incoming?.socket?.remoteAddress ??
      'local';
    if (!limiters.get(perMinute)(ip)) {
      return c.json({ ok: false, error: 'rate_limited', message: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
    }

    const type = c.req.header('content-type') ?? '';
    if (!type.includes('application/json')) {
      return c.json({ ok: false, error: 'invalid_content_type', message: 'Content-Type muss application/json sein.' }, 415);
    }
    const raw = await c.req.text();
    if (raw.length > 10_000) {
      return c.json({ ok: false, error: 'payload_too_large', message: 'Anfrage ist zu groß.' }, 413);
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: 'invalid_json', message: 'Ungültiges JSON.' }, 400);
    }

    const result = validateBotRequest(body);
    if (!result.ok) return c.json(result, 400);
    const payload = result.value;

    if (!configured(cfg)) {
      return c.json(
        {
          ok: false,
          error: 'not_configured',
          request_id: payload.request_id,
          message: 'Die Grok-Bot-Verbindung ist noch nicht eingerichtet (Webhook-URL und Schlüssel fehlen auf dem Server).',
        },
        503,
      );
    }

    const timeoutMs = Number(cfg.UPSTREAM_TIMEOUT_MS ?? 8000) || 8000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const doFetch = fetchImpl ?? fetch;
    try {
      const res = await doFetch(String(cfg.GROKBOT_WEBHOOK_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.GROKBOT_WEBHOOK_KEY}`,
          'X-Automation-Key': String(cfg.GROKBOT_WEBHOOK_KEY),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // drain body without exposing it
      try { await res.arrayBuffer(); } catch { /* ignore */ }
      if (res.ok) {
        log(`bot request ${payload.request_id} module=${payload.module} -> ${res.status}`);
        return c.json({ ok: true, status: 'sent', request_id: payload.request_id });
      }
      log(`bot request ${payload.request_id} upstream status ${res.status}`);
      const hint =
        res.status === 401 || res.status === 403
          ? 'Der Webhook hat den Schlüssel abgelehnt.'
          : res.status === 404
            ? 'Die Webhook-URL wurde nicht gefunden.'
            : res.status === 429
              ? 'Grok Bot nimmt gerade keine weiteren Anfragen an.'
              : 'Grok Bot hat die Anfrage nicht angenommen.';
      return c.json(
        { ok: false, error: 'upstream_error', upstream_status: res.status, request_id: payload.request_id, message: hint },
        502,
      );
    } catch (err) {
      const timedOut = err && typeof err === 'object' && 'name' in err && err.name === 'AbortError';
      log(`bot request ${payload.request_id} ${timedOut ? 'timeout' : 'unreachable'}`);
      return c.json(
        {
          ok: false,
          error: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
          request_id: payload.request_id,
          message: timedOut ? 'Grok Bot hat nicht rechtzeitig geantwortet (8 s).' : 'Grok Bot ist nicht erreichbar.',
        },
        timedOut ? 504 : 502,
      );
    } finally {
      clearTimeout(timer);
    }
  });

  registerCalendarRoutes(app, { getConfig, store, fetchImpl, log });
  registerPushRoutes(app, { getConfig, store, log, push });
  registerChatRoutes(app, { getConfig, fetchImpl, log });
  registerPairRoutes(app, { getConfig, log });

  app.all('/api/*', (c) => c.json({ ok: false, error: 'not_found' }, 404));
  app.onError((err, c) => {
    log(`internal error: ${err instanceof Error ? err.name : 'unknown'}`);
    return c.json({ ok: false, error: 'internal_error', message: 'Interner Fehler.' }, 500);
  });

  return app;
}
