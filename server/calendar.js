// Calendar routes: Google two-way sync (OAuth, server-side tokens, syncToken) and ICS subscription feed.
import { requireAppAuth } from './auth.js';
import { fromGoogle, toGoogle } from './google-map.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function googleCfg(cfg, requestUrl) {
  const origin = new URL(requestUrl).origin;
  return {
    clientId: cfg.GOOGLE_CLIENT_ID,
    clientSecret: cfg.GOOGLE_CLIENT_SECRET,
    redirectUri: cfg.GOOGLE_REDIRECT_URI || `${origin}/api/calendar/google/callback`,
    calendarId: cfg.GOOGLE_CALENDAR_ID || 'primary',
    timeZone: cfg.GOOGLE_TIMEZONE || 'Europe/Berlin',
    authBase: (cfg.GOOGLE_AUTH_BASE || 'https://accounts.google.com/o/oauth2/v2/auth').replace(/\/$/, ''),
    tokenUrl: cfg.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    apiBase: (cfg.GOOGLE_API_BASE || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, ''),
  };
}

const isConfigured = (g) => Boolean(g.clientId && g.clientSecret);

export function registerCalendarRoutes(app, { getConfig, store, fetchImpl, log = () => {} }) {
  const doFetch = (...a) => (fetchImpl ?? fetch)(...a);

  async function tokenRequest(g, params) {
    const res = await doFetch(g.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, ...params }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw Object.assign(new Error('token_error'), { status: res.status });
    return data;
  }

  async function accessToken(g) {
    const tokens = await store.get('google.tokens');
    if (!tokens?.refresh_token && !tokens?.access_token) throw new Error('not_connected');
    if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    if (!tokens.refresh_token) throw new Error('not_connected');
    const data = await tokenRequest(g, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    await store.set('google.tokens', {
      ...tokens,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  }

  async function gapi(g, path, init = {}) {
    const token = await accessToken(g);
    const res = await doFetch(`${g.apiBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    return res;
  }

  app.get('/api/calendar/status', async (c) => {
    const cfg = getConfig(c);
    const denied = requireAppAuth(c, cfg);
    if (denied) return denied;
    const g = googleCfg(cfg, c.req.url);
    const tokens = await store.get('google.tokens');
    const feedToken = cfg.CALENDAR_FEED_TOKEN;
    const feed = await store.get('feed.meta');
    return c.json({
      ok: true,
      google: { configured: isConfigured(g), connected: Boolean(tokens?.refresh_token || tokens?.access_token), lastSync: (await store.get('google.lastSync')) ?? undefined },
      feed: {
        enabled: Boolean(feedToken),
        url: feedToken ? `${cfg.PUBLIC_BASE_URL?.replace(/\/$/, '') || new URL(c.req.url).origin}/api/calendar/feed/${feedToken}.ics` : undefined,
        updatedAt: feed?.updatedAt,
      },
      caldav: { configured: false },
    });
  });

  app.get('/api/calendar/google/connect', async (c) => {
    const cfg = getConfig(c);
    const denied = requireAppAuth(c, cfg, { allowQueryToken: true });
    if (denied) return denied;
    const g = googleCfg(cfg, c.req.url);
    if (!isConfigured(g)) return c.json({ ok: false, error: 'not_configured', message: 'GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET fehlen.' }, 503);
    const state = crypto.randomUUID();
    const ret = c.req.query('return') ?? '/#/kalender';
    const origin = new URL(c.req.url).origin;
    const allowed = [origin, ...String(cfg.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
    let safeReturn = '/#/kalender';
    try {
      const u = new URL(ret, origin);
      if (allowed.includes(u.origin)) safeReturn = u.toString();
    } catch {
      /* ignore */
    }
    await store.set(`google.state.${state}`, { createdAt: Date.now(), ret: safeReturn });
    const url = new URL(g.authBase);
    url.search = new URLSearchParams({
      client_id: g.clientId,
      redirect_uri: g.redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get('/api/calendar/google/callback', async (c) => {
    const cfg = getConfig(c);
    const g = googleCfg(cfg, c.req.url);
    const state = c.req.query('state') ?? '';
    const saved = await store.get(`google.state.${state}`);
    if (!saved || Date.now() - saved.createdAt > 10 * 60_000) return c.text('Ungültiger oder abgelaufener Anmeldeversuch.', 400);
    await store.delete(`google.state.${state}`);
    const code = c.req.query('code');
    if (!code) return c.text(`Google-Anmeldung abgebrochen (${c.req.query('error') ?? 'kein Code'}).`, 400);
    try {
      const data = await tokenRequest(g, { grant_type: 'authorization_code', code, redirect_uri: g.redirectUri });
      await store.set('google.tokens', {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
        scope: data.scope,
      });
      await store.delete('google.syncToken');
      log('google connected');
      return c.redirect(saved.ret, 302);
    } catch {
      return c.text('Token-Austausch mit Google fehlgeschlagen.', 502);
    }
  });

  app.post('/api/calendar/google/disconnect', async (c) => {
    const cfg = getConfig(c);
    const denied = requireAppAuth(c, cfg);
    if (denied) return denied;
    await store.delete('google.tokens');
    await store.delete('google.syncToken');
    await store.delete('google.map');
    return c.json({ ok: true });
  });

  app.post('/api/calendar/google/sync', async (c) => {
    const cfg = getConfig(c);
    const denied = requireAppAuth(c, cfg);
    if (denied) return denied;
    const g = googleCfg(cfg, c.req.url);
    if (!isConfigured(g)) return c.json({ ok: false, error: 'not_configured', message: 'Google ist auf dem Server nicht eingerichtet.' }, 503);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_json' }, 400);
    }
    const changes = Array.isArray(body?.changes) ? body.changes.slice(0, 500) : [];
    const deletions = Array.isArray(body?.deletions) ? body.deletions.slice(0, 500) : [];
    const cal = encodeURIComponent(g.calendarId);
    /** uid → googleId */
    const map = (await store.get('google.map')) ?? {};
    const pushed = [];
    const pushedEtags = new Map();
    const deleted = [];
    try {
      // 1) push local changes
      for (const ev of changes) {
        if (!ev || typeof ev.uid !== 'string' || typeof ev.title !== 'string' || typeof ev.date !== 'string') continue;
        const googleId = ev.googleId || map[ev.uid];
        const resource = toGoogle(ev, g.timeZone);
        let res;
        if (googleId) {
          const { iCalUID: _omit, ...patch } = resource;
          res = await gapi(g, `/calendars/${cal}/events/${encodeURIComponent(googleId)}`, { method: 'PUT', body: JSON.stringify(patch) });
          if (res.status === 404 || res.status === 410) {
            res = await gapi(g, `/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify(resource) });
          }
        } else {
          res = await gapi(g, `/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify(resource) });
        }
        if (!res.ok) {
          log(`google push failed ${res.status}`);
          continue;
        }
        const saved = await res.json();
        map[ev.uid] = saved.id;
        pushed.push({ uid: ev.uid, googleId: saved.id, etag: saved.etag });
        pushedEtags.set(saved.id, saved.etag);
      }
      // 2) push deletions
      for (const t of deletions) {
        const googleId = t?.googleId || map[t?.uid];
        if (!googleId) continue;
        const res = await gapi(g, `/calendars/${cal}/events/${encodeURIComponent(googleId)}`, { method: 'DELETE' });
        if (res.ok || res.status === 404 || res.status === 410) {
          delete map[t.uid];
          pushedEtags.set(googleId, 'deleted');
        }
      }
      // 3) pull remote changes (incremental with syncToken)
      const remote = [];
      let syncToken = await store.get('google.syncToken');
      let pageToken;
      let nextSyncToken;
      for (let page = 0; page < 50; page += 1) {
        const qs = new URLSearchParams({ maxResults: '250', showDeleted: 'true' });
        if (syncToken) qs.set('syncToken', syncToken);
        else qs.set('timeMin', new Date(Date.now() - 365 * 86_400_000).toISOString());
        if (pageToken) qs.set('pageToken', pageToken);
        const res = await gapi(g, `/calendars/${cal}/events?${qs}`);
        if (res.status === 410) {
          // sync token expired → full resync
          syncToken = undefined;
          pageToken = undefined;
          await store.delete('google.syncToken');
          continue;
        }
        if (!res.ok) throw Object.assign(new Error('list_failed'), { status: res.status });
        const data = await res.json();
        for (const item of data.items ?? []) {
          if (pushedEtags.has(item.id) && (pushedEtags.get(item.id) === item.etag || pushedEtags.get(item.id) === 'deleted')) continue;
          if (item.recurringEventId) continue; // single modified instances not supported yet
          const uid = item.iCalUID ?? Object.keys(map).find((u) => map[u] === item.id);
          if (item.status === 'cancelled') {
            if (uid) {
              deleted.push(uid);
              delete map[uid];
            }
            continue;
          }
          const ev = fromGoogle(item, g.timeZone);
          if (ev) {
            map[ev.uid] = item.id;
            remote.push(ev);
          }
        }
        pageToken = data.nextPageToken;
        if (!pageToken) {
          nextSyncToken = data.nextSyncToken;
          break;
        }
      }
      if (nextSyncToken) await store.set('google.syncToken', nextSyncToken);
      await store.set('google.map', map);
      await store.set('google.lastSync', new Date().toISOString());
      log(`google sync pushed=${pushed.length} pulled=${remote.length} deleted=${deleted.length}`);
      return c.json({ ok: true, pushed, remote, deleted });
    } catch (err) {
      await store.set('google.map', map);
      if (err?.message === 'not_connected') return c.json({ ok: false, error: 'not_connected', message: 'Google ist noch nicht verbunden.' }, 409);
      if (err?.message === 'token_error') return c.json({ ok: false, error: 'google_auth', message: 'Google-Anmeldung abgelaufen. Bitte neu verbinden.' }, 401);
      log(`google sync error ${err?.status ?? ''}`);
      return c.json({ ok: false, error: 'google_error', message: 'Google-Kalender hat einen Fehler gemeldet.' }, 502);
    }
  });

  // ICS subscription feed (read-only, e.g. Apple Kalender "Kalenderabonnement")
  app.put('/api/calendar/feed', async (c) => {
    const cfg = getConfig(c);
    const denied = requireAppAuth(c, cfg);
    if (denied) return denied;
    if (!cfg.CALENDAR_FEED_TOKEN) return c.json({ ok: false, error: 'not_configured', message: 'CALENDAR_FEED_TOKEN fehlt auf dem Server.' }, 503);
    const body = await c.req.json().catch(() => null);
    const ics = body?.ics;
    if (typeof ics !== 'string' || !ics.startsWith('BEGIN:VCALENDAR') || ics.length > 2_000_000) {
      return c.json({ ok: false, error: 'invalid_ics', message: 'Ungültige Kalenderdaten.' }, 400);
    }
    await store.set('feed.ics', ics);
    await store.set('feed.meta', { updatedAt: new Date().toISOString() });
    const base = cfg.PUBLIC_BASE_URL?.replace(/\/$/, '') || new URL(c.req.url).origin;
    return c.json({ ok: true, url: `${base}/api/calendar/feed/${cfg.CALENDAR_FEED_TOKEN}.ics` });
  });

  app.get('/api/calendar/feed/:file', async (c) => {
    const cfg = getConfig(c);
    const file = c.req.param('file');
    if (!cfg.CALENDAR_FEED_TOKEN || file !== `${cfg.CALENDAR_FEED_TOKEN}.ics`) return c.text('Not found', 404);
    const ics = (await store.get('feed.ics')) ?? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Nova//Kalender 1.0//DE\r\nX-WR-CALNAME:Nova\r\nEND:VCALENDAR\r\n';
    return c.body(ics, 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' });
  });
}
