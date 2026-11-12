import { getAll, getById, getByIndex, getMeta, putRecord, removeRecord, setMeta, STORES } from '../../data/db';
import { addDays } from '../../shared/dates';
import { expandAll, type EventInstance } from './recurrence';
import { createEventUid, createId } from '../../shared/id';
import type { CalendarEvent, Tombstone } from '../../types';
import { importIcs, type ParsedIcsEvent } from './ics';

export async function listEvents(): Promise<CalendarEvent[]> {
  const events = await getAll<CalendarEvent>(STORES.events);
  return events.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startTime ?? '').localeCompare(b.startTime ?? '');
  });
}

export async function listEventsOn(date: string): Promise<CalendarEvent[]> {
  const events = await getByIndex<CalendarEvent>(STORES.events, 'date', date);
  return events.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startTime ?? '').localeCompare(b.startTime ?? '');
  });
}

export async function upcomingEvents(fromDate: string, limit = 8): Promise<CalendarEvent[]> {
  const events = await listEvents();
  return events.filter((event) => (event.endDate ?? event.date) >= fromDate).slice(0, limit);
}

export type EventInput = Omit<CalendarEvent, 'id' | 'uid' | 'createdAt' | 'updatedAt'> & Partial<Pick<CalendarEvent, 'id' | 'uid' | 'createdAt' | 'updatedAt'>>;

export async function saveEvent(input: EventInput, opts: { keepUpdatedAt?: boolean } = {}): Promise<CalendarEvent> {
  const now = new Date().toISOString();
  const id = input.id ?? createId();
  const event: CalendarEvent = {
    id,
    uid: input.uid ?? createEventUid(id),
    title: input.title.trim(),
    date: input.date,
    endDate: input.endDate,
    startTime: input.allDay ? undefined : input.startTime,
    endTime: input.allDay ? undefined : input.endTime,
    allDay: input.allDay,
    location: input.location?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    calendarId: input.calendarId ?? 'nova',
    color: input.color || undefined,
    rrule: input.rrule || undefined,
    exdates: input.exdates ?? [],
    reminderMinutes: input.reminderMinutes,
    googleId: input.googleId,
    googleEtag: input.googleEtag,
    syncDirty: input.syncDirty ?? true,
    createdAt: input.createdAt ?? now,
    updatedAt: opts.keepUpdatedAt && input.updatedAt ? input.updatedAt : now,
  };
  return putRecord(STORES.events, event);
}

export async function getEvent(id: string): Promise<CalendarEvent | undefined> {
  return getById<CalendarEvent>(STORES.events, id);
}

export async function deleteEvent(id: string): Promise<void> {
  const event = await getEvent(id);
  await removeRecord(STORES.events, id);
  if (event) {
    const tombstones = (await getMeta<Tombstone[]>(TOMBSTONES_KEY)) ?? [];
    tombstones.push({ uid: event.uid, googleId: event.googleId, deletedAt: new Date().toISOString() });
    await setMeta(TOMBSTONES_KEY, tombstones.slice(-500));
  }
}

export const TOMBSTONES_KEY = 'calendar.tombstones';

export async function listTombstones(): Promise<Tombstone[]> {
  return (await getMeta<Tombstone[]>(TOMBSTONES_KEY)) ?? [];
}

export async function clearTombstones(uids: string[]): Promise<void> {
  const set = new Set(uids);
  await setMeta(TOMBSTONES_KEY, (await listTombstones()).filter((t) => !set.has(t.uid)));
}

/** Delete without tombstone (remote deletion applied locally). */
export async function deleteEventLocalOnly(id: string): Promise<void> {
  await removeRecord(STORES.events, id);
}

export async function excludeOccurrence(id: string, date: string): Promise<void> {
  const event = await getEvent(id);
  if (!event) return;
  await saveEvent({ ...event, exdates: [...new Set([...(event.exdates ?? []), date])] });
}

export async function getEventByUid(uid: string): Promise<CalendarEvent | undefined> {
  return (await listEvents()).find((e) => e.uid === uid);
}

/** Instances in the next `days` days, recurrence expanded. */
export async function upcomingInstances(fromDate: string, days = 60, limit = 8): Promise<EventInstance[]> {
  return expandAll(await listEvents(), fromDate, addDays(fromDate, days)).filter((i) => i.endDate >= fromDate).slice(0, limit);
}

export async function importParsedEvents(parsed: ParsedIcsEvent[]): Promise<{ added: number; updated: number }> {
  const existing = await listEvents();
  const byUid = new Map(existing.map((event) => [event.uid, event]));
  let added = 0;
  let updated = 0;

  for (const item of parsed) {
    const found = byUid.get(item.uid);
    await saveEvent({
      ...(found ?? {}),
      ...item,
      id: found?.id,
      uid: item.uid,
      createdAt: found?.createdAt,
    });
    if (found) updated += 1;
    else added += 1;
  }

  return { added, updated };
}

export async function importIcsText(icsText: string): Promise<{ added: number; updated: number; total: number }> {
  const parsed = importIcs(icsText);
  const result = await importParsedEvents(parsed);
  return { ...result, total: parsed.length };
}
