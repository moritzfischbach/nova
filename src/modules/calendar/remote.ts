/**
 * Client side of external calendar sync. Credentials and OAuth tokens live
 * only on the Nova server; the browser exchanges plain event data.
 */
import { apiHeaders, apiUrl, fetchWithTimeout, STATIC_ONLY } from '../../shared/api';
import type { CalendarEvent } from '../../types';
import { exportIcs } from './ics';
import {
  clearTombstones,
  deleteEventLocalOnly,
  getEventByUid,
  listEvents,
  listTombstones,
  saveEvent,
  type EventInput,
} from './repo';

export interface CalendarRemoteStatus {
  staticOnly?: boolean;
  reachable: boolean;
  google: { configured: boolean; connected: boolean; lastSync?: string };
  feed: { enabled: boolean; url?: string; updatedAt?: string };
  caldav: { configured: boolean };
}

export async function getCalendarRemoteStatus(): Promise<CalendarRemoteStatus> {
  if (STATIC_ONLY) return { staticOnly: true, reachable: false, google: { configured: false, connected: false }, feed: { enabled: false }, caldav: { configured: false } };
  try {
    const res = await fetchWithTimeout(apiUrl('api/calendar/status'), { headers: apiHeaders(false) }, 5000);
    if (!res.ok) throw new Error();
    return { reachable: true, ...(await res.json()) };
  } catch {
    return { reachable: false, google: { configured: false, connected: false }, feed: { enabled: false }, caldav: { configured: false } };
  }
}

export function googleConnectUrl(): string {
  return apiUrl(`api/calendar/google/connect?return=${encodeURIComponent(location.href.split('#')[0] + '#/kalender')}`);
}

/** Event shape exchanged with the server (no local-only fields). */
export type WireEvent = Pick<
  CalendarEvent,
  'uid' | 'title' | 'date' | 'endDate' | 'startTime' | 'endTime' | 'allDay' | 'location' | 'notes' | 'color' | 'rrule' | 'exdates' | 'reminderMinutes' | 'googleId' | 'googleEtag' | 'updatedAt'
>;

export function toWire(e: CalendarEvent): WireEvent {
  const { uid, title, date, endDate, startTime, endTime, allDay, location, notes, color, rrule, exdates, reminderMinutes, googleId, googleEtag, updatedAt } = e;
  return { uid, title, date, endDate, startTime, endTime, allDay, location, notes, color, rrule, exdates, reminderMinutes, googleId, googleEtag, updatedAt };
}

export interface GoogleSyncResponse {
  ok: boolean;
  error?: string;
  message?: string;
  pushed?: { uid: string; googleId: string; etag?: string }[];
  remote?: WireEvent[];
  deleted?: string[];
}

/** Applies a server sync response to the local store. Exported for tests. */
export async function applyGoogleSync(result: GoogleSyncResponse, sentUids: string[], sentTombstones: string[]): Promise<{ pulled: number; deleted: number }> {
  for (const p of result.pushed ?? []) {
    const local = await getEventByUid(p.uid);
    if (local) await saveEvent({ ...local, googleId: p.googleId, googleEtag: p.etag, syncDirty: false }, { keepUpdatedAt: true });
  }
  for (const uid of sentUids) {
    const local = await getEventByUid(uid);
    if (local?.syncDirty) await saveEvent({ ...local, syncDirty: false }, { keepUpdatedAt: true });
  }
  let pulled = 0;
  for (const remote of result.remote ?? []) {
    const local = await getEventByUid(remote.uid);
    if (local?.syncDirty && local.updatedAt > (remote.updatedAt ?? '')) continue; // local newer wins
    const input: EventInput = { ...(local ?? {}), ...remote, id: local?.id, createdAt: local?.createdAt, syncDirty: false };
    await saveEvent(input, { keepUpdatedAt: true });
    pulled += 1;
  }
  let deleted = 0;
  for (const uid of result.deleted ?? []) {
    const local = await getEventByUid(uid);
    if (local) {
      await deleteEventLocalOnly(local.id);
      deleted += 1;
    }
  }
  await clearTombstones(sentTombstones);
  return { pulled, deleted };
}

export async function syncGoogle(): Promise<{ pulled: number; pushed: number; deleted: number }> {
  const events = await listEvents();
  const dirty = events.filter((e) => e.syncDirty || !e.googleId);
  const tombstones = await listTombstones();
  const res = await fetchWithTimeout(
    apiUrl('api/calendar/google/sync'),
    {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ changes: dirty.map(toWire), deletions: tombstones }),
    },
    30000,
  );
  const data = (await res.json()) as GoogleSyncResponse;
  if (!res.ok || !data.ok) throw new Error(data.message ?? 'Google-Sync fehlgeschlagen.');
  const applied = await applyGoogleSync(data, dirty.map((e) => e.uid), tombstones.map((t) => t.uid));
  return { ...applied, pushed: data.pushed?.length ?? 0 };
}

/** Uploads a snapshot so the server can serve an ICS subscription feed (Apple Kalender: "Abonnement"). */
export async function publishFeed(): Promise<{ url: string }> {
  const ics = exportIcs(await listEvents());
  const res = await fetchWithTimeout(apiUrl('api/calendar/feed'), {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ ics }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message ?? 'Feed konnte nicht veröffentlicht werden.');
  return { url: data.url };
}
