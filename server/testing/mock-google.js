// In-memory mock of the Google OAuth token endpoint + Calendar v3 events API (subset).
import { createServer } from 'node:http';

export function createMockGoogle() {
  const state = {
    events: new Map(), // id -> event
    seq: 0,
    version: 0, // global change counter
    tokens: { access: new Set(), refresh: new Set(['refresh-1']) },
    requests: [],
    invalidSyncTokens: new Set(),
  };
  const touch = (ev) => {
    state.version += 1;
    ev._v = state.version;
    ev.etag = `"etag-${ev.id}-${state.version}"`;
    ev.updated = new Date(Date.now() + state.version).toISOString();
    return ev;
  };
  const publicEv = ({ _v, ...rest }) => rest;

  /** Simulate a change made directly in Google Calendar. */
  const remote = {
    insert(ev) {
      const id = `g${++state.seq}`;
      const e = touch({ id, status: 'confirmed', iCalUID: ev.iCalUID ?? `${id}@google.com`, ...ev });
      state.events.set(id, e);
      return e;
    },
    update(id, patch) {
      const e = touch({ ...state.events.get(id), ...patch });
      state.events.set(id, e);
      return e;
    },
    cancel(id) {
      return remote.update(id, { status: 'cancelled' });
    },
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
      const json = (code, data) => {
        res.statusCode = code;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/auth') {
        // consent screen stand-in: immediately redirect back with a code
        const back = new URL(url.searchParams.get('redirect_uri'));
        back.searchParams.set('code', 'good-code');
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.statusCode = 302;
        res.setHeader('location', back.toString());
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const p = new URLSearchParams(body);
        if (p.get('client_secret') !== 'test-client-secret') return json(401, { error: 'invalid_client' });
        if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'good-code') {
          const at = `access-${++state.seq}`;
          state.tokens.access.add(at);
          return json(200, { access_token: at, refresh_token: 'refresh-1', expires_in: 3600, scope: 'calendar.events' });
        }
        if (p.get('grant_type') === 'refresh_token' && state.tokens.refresh.has(p.get('refresh_token'))) {
          const at = `access-${++state.seq}`;
          state.tokens.access.add(at);
          return json(200, { access_token: at, expires_in: 3600 });
        }
        return json(400, { error: 'invalid_grant' });
      }
      const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
      if (!m) return json(404, { error: 'not_found' });
      const auth = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (!state.tokens.access.has(auth)) return json(401, { error: 'unauthenticated' });
      const id = m[2] && decodeURIComponent(m[2]);
      if (!id && req.method === 'GET') {
        const st = url.searchParams.get('syncToken');
        if (st && state.invalidSyncTokens.has(st)) return json(410, { error: 'gone' });
        const since = st ? Number(st.replace('sync-', '')) : 0;
        const items = [...state.events.values()].filter((e) => e._v > since && (st || e.status !== 'cancelled')).map(publicEv);
        return json(200, { items, nextSyncToken: `sync-${state.version}` });
      }
      if (!id && req.method === 'POST') {
        const data = JSON.parse(body);
        return json(200, publicEv(remote.insert(data)));
      }
      const existing = state.events.get(id);
      if (!existing || existing.status === 'cancelled') return json(404, { error: 'not_found' });
      if (req.method === 'PUT') return json(200, publicEv(remote.update(id, JSON.parse(body))));
      if (req.method === 'DELETE') {
        remote.cancel(id);
        res.statusCode = 204;
        return res.end();
      }
      return json(405, {});
    });
  });

  return {
    state,
    remote,
    server,
    async listen(port = 0) {
      await new Promise((r) => server.listen(port, '127.0.0.1', r));
      const base = `http://127.0.0.1:${server.address().port}`;
      return {
        base,
        config: {
          GOOGLE_CLIENT_ID: 'test-client-id',
          GOOGLE_CLIENT_SECRET: 'test-client-secret',
          GOOGLE_AUTH_BASE: `${base}/auth`,
          GOOGLE_TOKEN_URL: `${base}/token`,
          GOOGLE_API_BASE: `${base}/calendar/v3`,
          GOOGLE_TIMEZONE: 'Europe/Berlin',
        },
      };
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
