import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { fromGoogle, toGoogle, toZoned } from './google-map.js';
import { memoryStore } from './store.js';
import { createMockGoogle } from './testing/mock-google.js';

describe('google mapping', () => {
  it('timed event with recurrence + exdate + reminder', () => {
    const g = toGoogle({ uid: 'u1', title: 'Yoga', date: '2026-11-16', startTime: '18:00', endTime: '19:00', allDay: false, rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-11-23'], reminderMinutes: 10 }, 'Europe/Berlin');
    expect(g.start).toEqual({ dateTime: '2026-11-16T18:00:00', timeZone: 'Europe/Berlin' });
    expect(g.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Berlin:20261123T180000']);
    expect(g.reminders.overrides[0]).toEqual({ method: 'popup', minutes: 10 });
    expect(g.iCalUID).toBe('u1');
  });
  it('all-day multi-day end is exclusive', () => {
    const g = toGoogle({ uid: 'u2', title: 'Urlaub', date: '2026-12-24', endDate: '2026-12-26', allDay: true }, 'Europe/Berlin');
    expect(g.end).toEqual({ date: '2026-12-27' });
    const back = fromGoogle({ id: 'x', ...g }, 'Europe/Berlin');
    expect(back).toMatchObject({ allDay: true, date: '2026-12-24', endDate: '2026-12-26', uid: 'u2' });
  });
  it('converts UTC instants into Europe/Berlin local time (DST aware)', () => {
    expect(toZoned('2026-11-15T09:00:00Z', 'Europe/Berlin')).toEqual({ date: '2026-11-15', time: '10:00' });
    expect(toZoned('2026-07-15T09:00:00Z', 'Europe/Berlin')).toEqual({ date: '2026-07-15', time: '11:00' });
    const ev = fromGoogle({ id: 'a', iCalUID: 'a@g', summary: 'Call', start: { dateTime: '2026-11-15T23:30:00Z' }, end: { dateTime: '2026-11-16T00:30:00Z' } }, 'Europe/Berlin');
    expect(ev).toMatchObject({ date: '2026-11-16', startTime: '00:30', endTime: '01:30' });
  });
});

describe('Google two-way sync against mock', () => {
  const mock = createMockGoogle();
  let cfg;
  const store = memoryStore();
  let app;
  const H = { 'x-nova-token': 'tok', 'content-type': 'application/json' };
  const sync = async (body) => {
    const r = await app.request('http://nova.local/api/calendar/google/sync', { method: 'POST', headers: H, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };

  beforeAll(async () => {
    const { config } = await mock.listen();
    cfg = { ...config, NOVA_APP_TOKEN: 'tok' };
    app = createApp({ getConfig: () => cfg, store });
  });
  afterAll(() => mock.close());

  it('requires the app token', async () => {
    const r = await app.request('http://nova.local/api/calendar/google/sync', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(401);
    expect((await app.request('http://nova.local/api/calendar/status')).status).toBe(401);
  });

  it('reports not connected before OAuth', async () => {
    const st = await (await app.request('http://nova.local/api/calendar/status', { headers: H })).json();
    expect(st.google).toMatchObject({ configured: true, connected: false });
    expect((await sync({ changes: [] })).status).toBe(409);
  });

  it('OAuth connect → callback stores tokens server-side', async () => {
    const r = await app.request('http://nova.local/api/calendar/google/connect?t=tok&return=http://nova.local/%23/kalender');
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get('location'));
    expect(loc.searchParams.get('client_id')).toBe('test-client-id');
    expect(loc.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.events');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('redirect_uri')).toBe('http://nova.local/api/calendar/google/callback');
    const state = loc.searchParams.get('state');
    const bad = await app.request(`http://nova.local/api/calendar/google/callback?state=wrong&code=good-code`);
    expect(bad.status).toBe(400);
    const cb = await app.request(`http://nova.local/api/calendar/google/callback?state=${state}&code=good-code`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('http://nova.local/#/kalender');
    const tokens = await store.get('google.tokens');
    expect(tokens.refresh_token).toBe('refresh-1');
    const st = await (await app.request('http://nova.local/api/calendar/status', { headers: H })).json();
    expect(JSON.stringify(st)).not.toContain('refresh-1');
    expect(st.google.connected).toBe(true);
  });

  it('pushes local events and does a full initial pull', async () => {
    mock.remote.insert({ summary: 'Von Google', start: { dateTime: '2026-11-20T08:00:00Z' }, end: { dateTime: '2026-11-20T09:00:00Z' } });
    const { status, data } = await sync({
      changes: [
        { uid: 'n1@nova.local', title: 'Zahnarzt', date: '2026-11-18', startTime: '10:00', endTime: '11:00', allDay: false, updatedAt: '2026-11-12T08:00:00Z' },
        { uid: 'n2@nova.local', title: 'Yoga', date: '2026-11-16', startTime: '18:00', endTime: '19:00', allDay: false, rrule: 'FREQ=WEEKLY;BYDAY=MO', updatedAt: '2026-11-12T08:00:00Z' },
      ],
      deletions: [],
    });
    expect(status).toBe(200);
    expect(data.pushed.map((p) => p.uid)).toEqual(['n1@nova.local', 'n2@nova.local']);
    const inserts = mock.state.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/events'));
    expect(JSON.parse(inserts[0].body)).toMatchObject({ summary: 'Zahnarzt', iCalUID: 'n1@nova.local', start: { dateTime: '2026-11-18T10:00:00', timeZone: 'Europe/Berlin' } });
    expect(JSON.parse(inserts[1].body).recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
    // own pushes are not echoed back, the Google-side event is pulled
    expect(data.remote.map((e) => e.title)).toEqual(['Von Google']);
    expect(data.remote[0]).toMatchObject({ date: '2026-11-20', startTime: '09:00', endTime: '10:00' });
    expect(await store.get('google.syncToken')).toMatch(/^sync-/);
  });

  it('incremental pull uses syncToken and reports remote edits + deletions', async () => {
    const pushedYoga = [...mock.state.events.values()].find((e) => e.iCalUID === 'n2@nova.local');
    const fromGoogleEv = [...mock.state.events.values()].find((e) => e.summary === 'Von Google');
    mock.remote.update(fromGoogleEv.id, { summary: 'Von Google (geändert)' });
    mock.remote.cancel(pushedYoga.id);
    mock.state.requests.length = 0;
    const { data } = await sync({ changes: [], deletions: [] });
    const list = mock.state.requests.find((r) => r.method === 'GET');
    expect(list.query.syncToken).toMatch(/^sync-/);
    expect(data.remote.map((e) => e.title)).toEqual(['Von Google (geändert)']);
    expect(data.deleted).toEqual(['n2@nova.local']);
  });

  it('updates existing events via PUT and deletes via tombstones', async () => {
    const zahnarzt = [...mock.state.events.values()].find((e) => e.iCalUID === 'n1@nova.local');
    mock.state.requests.length = 0;
    const { data } = await sync({ changes: [{ uid: 'n1@nova.local', googleId: zahnarzt.id, title: 'Zahnarzt (verschoben)', date: '2026-11-19', startTime: '14:00', endTime: '15:00', allDay: false }], deletions: [] });
    expect(mock.state.requests.find((r) => r.method === 'PUT')).toBeTruthy();
    expect(mock.state.events.get(zahnarzt.id).summary).toBe('Zahnarzt (verschoben)');
    expect(data.remote).toEqual([]);
    await sync({ changes: [], deletions: [{ uid: 'n1@nova.local', googleId: zahnarzt.id }] });
    expect(mock.state.events.get(zahnarzt.id).status).toBe('cancelled');
  });

  it('refreshes an expired access token', async () => {
    const tokens = await store.get('google.tokens');
    await store.set('google.tokens', { ...tokens, expires_at: 0 });
    mock.state.requests.length = 0;
    const { status } = await sync({ changes: [] });
    expect(status).toBe(200);
    const tokenReq = mock.state.requests.find((r) => r.path === '/token');
    expect(new URLSearchParams(tokenReq.body).get('grant_type')).toBe('refresh_token');
  });

  it('falls back to full sync when the syncToken expired (410)', async () => {
    mock.state.invalidSyncTokens.add(await store.get('google.syncToken'));
    mock.state.requests.length = 0;
    const { status, data } = await sync({ changes: [] });
    expect(status).toBe(200);
    const lists = mock.state.requests.filter((r) => r.method === 'GET');
    expect(lists).toHaveLength(2);
    expect(lists[1].query.syncToken).toBeUndefined();
    expect(data.remote.some((e) => e.title === 'Von Google (geändert)')).toBe(true);
  });
});

describe('ICS feed', () => {
  it('publishes and serves the feed only with the right token', async () => {
    const app = createApp({ getConfig: () => ({ NOVA_APP_TOKEN: 'tok', CALENDAR_FEED_TOKEN: 'feed-abc' }), store: memoryStore() });
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Test\r\nDTSTART;VALUE=DATE:20261120\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const put = await app.request('http://nova.local/api/calendar/feed', { method: 'PUT', headers: { 'x-nova-token': 'tok', 'content-type': 'application/json' }, body: JSON.stringify({ ics }) });
    expect((await put.json()).url).toBe('http://nova.local/api/calendar/feed/feed-abc.ics');
    const res = await app.request('http://nova.local/api/calendar/feed/feed-abc.ics');
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toContain('SUMMARY:Test');
    expect((await app.request('http://nova.local/api/calendar/feed/wrong.ics')).status).toBe(404);
  });
});
