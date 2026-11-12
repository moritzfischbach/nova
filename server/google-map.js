// Mapping between Nova wire events and Google Calendar API events.

const pad = (n) => String(n).padStart(2, '0');

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Converts an RFC3339 instant to local date/time parts in the given IANA time zone. */
export function toZoned(dateTime, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(dateTime))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Nova wire event → Google event resource. */
export function toGoogle(ev, timeZone) {
  const body = {
    summary: ev.title,
    location: ev.location ?? '',
    description: ev.notes ?? '',
    iCalUID: ev.uid,
  };
  const endDate = ev.endDate ?? ev.date;
  if (ev.allDay) {
    body.start = { date: ev.date };
    body.end = { date: addDays(endDate, 1) };
  } else {
    body.start = { dateTime: `${ev.date}T${ev.startTime ?? '09:00'}:00`, timeZone };
    body.end = { dateTime: `${endDate}T${ev.endTime ?? ev.startTime ?? '10:00'}:00`, timeZone };
  }
  const recurrence = [];
  if (ev.rrule) recurrence.push(`RRULE:${ev.rrule}`);
  for (const ex of ev.exdates ?? []) {
    recurrence.push(
      ev.allDay
        ? `EXDATE;VALUE=DATE:${ex.replace(/-/g, '')}`
        : `EXDATE;TZID=${timeZone}:${ex.replace(/-/g, '')}T${(ev.startTime ?? '09:00').replace(':', '')}00`,
    );
  }
  if (recurrence.length) body.recurrence = recurrence;
  body.reminders =
    ev.reminderMinutes !== undefined && ev.reminderMinutes !== null
      ? { useDefault: false, overrides: [{ method: 'popup', minutes: ev.reminderMinutes }] }
      : { useDefault: false, overrides: [] };
  return body;
}

/** Google event resource → Nova wire event (or null if not representable). */
export function fromGoogle(g, timeZone) {
  if (!g.start) return null;
  const ev = {
    uid: g.iCalUID ?? `${g.id}@google.com`,
    googleId: g.id,
    googleEtag: g.etag,
    title: g.summary ?? '(ohne Titel)',
    location: g.location || undefined,
    notes: g.description || undefined,
    updatedAt: g.updated ?? new Date().toISOString(),
  };
  if (g.start.date) {
    ev.allDay = true;
    ev.date = g.start.date;
    const endIncl = g.end?.date ? addDays(g.end.date, -1) : g.start.date;
    if (endIncl > ev.date) ev.endDate = endIncl;
  } else {
    const tz = g.start.timeZone ?? timeZone;
    const s = toZoned(g.start.dateTime, tz);
    const e = g.end?.dateTime ? toZoned(g.end.dateTime, g.end.timeZone ?? tz) : s;
    ev.allDay = false;
    ev.date = s.date;
    ev.startTime = s.time;
    ev.endTime = e.time;
    if (e.date !== s.date) ev.endDate = e.date;
  }
  for (const line of g.recurrence ?? []) {
    if (line.startsWith('RRULE:')) ev.rrule = line.slice(6);
    if (line.startsWith('EXDATE')) {
      const values = line.slice(line.indexOf(':') + 1).split(',');
      ev.exdates = [...(ev.exdates ?? []), ...values.map((v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`)];
    }
  }
  const override = g.reminders?.overrides?.[0];
  if (override) ev.reminderMinutes = override.minutes;
  return ev;
}
