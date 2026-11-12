import { addDays, formatISODate, pad2 } from '../../shared/dates';
import type { CalendarEvent } from '../../types';

const PRODID = '-//Nova//Kalender 1.0//DE';

export interface ParsedIcsEvent {
  uid: string;
  title: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  rrule?: string;
  exdates?: string[];
  color?: string;
  reminderMinutes?: number;
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

export function unescapeIcsText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  let result = '';
  let current = '';
  for (const char of line) {
    const next = current + char;
    if (encoder.encode(next).length > 75) {
      result += `${current}\r\n `;
      current = char;
    } else {
      current = next;
    }
  }
  return result + current;
}

export function unfoldIcs(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function ymd(date: string): string {
  return date.replace(/-/g, '');
}

function dateTimeLocal(date: string, time?: string): string {
  const [hours = '00', minutes = '00'] = (time ?? '00:00').split(':');
  return `${ymd(date)}T${hours.padStart(2, '0')}${minutes.padStart(2, '0')}00`;
}

export function formatUtcStamp(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

export function eventToVeEvent(event: CalendarEvent): string {
  const lines = ['BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${formatUtcStamp(event.updatedAt)}`];

  if (event.allDay) {
    const endDate = event.endDate ?? event.date;
    lines.push(`DTSTART;VALUE=DATE:${ymd(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${ymd(addDays(endDate, 1))}`);
  } else {
    const endDate = event.endDate ?? event.date;
    const endTime = event.endTime ?? event.startTime ?? '00:00';
    lines.push(`DTSTART:${dateTimeLocal(event.date, event.startTime)}`);
    lines.push(`DTEND:${dateTimeLocal(endDate, endTime)}`);
  }

  if (event.rrule) lines.push(`RRULE:${event.rrule}`);
  for (const ex of event.exdates ?? []) {
    lines.push(event.allDay ? `EXDATE;VALUE=DATE:${ymd(ex)}` : `EXDATE:${dateTimeLocal(ex, event.startTime)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.color) lines.push(`COLOR:${event.color}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`);
  lines.push(`LAST-MODIFIED:${formatUtcStamp(event.updatedAt)}`);
  if (event.reminderMinutes !== undefined) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(event.title)}`, `TRIGGER:-PT${event.reminderMinutes}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines.map(foldLine).join('\r\n');
}

export function exportIcs(events: CalendarEvent[]): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Nova',
  ];
  return `${[...header.map(foldLine), ...events.map(eventToVeEvent), 'END:VCALENDAR'].join('\r\n')}\r\n`;
}

interface RawField {
  params: string;
  value: string;
}

function parseIcsDate(value: string, params: string): { date: string; time?: string; allDay: boolean } {
  const cleaned = value.trim();
  const isDateOnly = params.includes('VALUE=DATE') || /^\d{8}$/.test(cleaned);
  if (cleaned.endsWith('Z') && cleaned.includes('T')) {
    const iso = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}T${cleaned.slice(9, 11)}:${cleaned.slice(11, 13)}:${cleaned.slice(13, 15) || '00'}Z`;
    const date = new Date(iso);
    return {
      date: formatISODate(date),
      time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
      allDay: false,
    };
  }

  const date = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  if (isDateOnly || cleaned.length === 8) {
    return { date, allDay: true };
  }
  return {
    date,
    time: `${cleaned.slice(9, 11)}:${cleaned.slice(11, 13)}`,
    allDay: false,
  };
}

function veventToParsed(fields: Record<string, RawField>): ParsedIcsEvent | null {
  const summary = fields.SUMMARY?.value;
  const dtstart = fields.DTSTART;
  if (!summary || !dtstart) return null;

  const start = parseIcsDate(dtstart.value, dtstart.params);
  const end = fields.DTEND ? parseIcsDate(fields.DTEND.value, fields.DTEND.params) : null;

  let endDate: string | undefined;
  let endTime: string | undefined;
  if (end) {
    if (start.allDay || end.allDay) {
      endDate = addDays(end.date, -1);
      if (endDate === start.date) endDate = undefined;
    } else {
      endDate = end.date === start.date ? undefined : end.date;
      endTime = end.time;
    }
  }

  return {
    uid: fields.UID?.value?.trim() || `imported-${crypto.randomUUID?.() ?? Date.now()}@nova.local`,
    title: unescapeIcsText(summary),
    date: start.date,
    endDate,
    startTime: start.allDay ? undefined : start.time,
    endTime,
    allDay: start.allDay,
    location: fields.LOCATION ? unescapeIcsText(fields.LOCATION.value) : undefined,
    notes: fields.DESCRIPTION ? unescapeIcsText(fields.DESCRIPTION.value) : undefined,
  };
}

function parseTrigger(value: string): number | undefined {
  const m = value.trim().match(/^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return undefined;
  const [, w, d, h, min] = m.map((x) => Number(x ?? 0));
  return w * 10080 + d * 1440 + h * 60 + min;
}

export function importIcs(ics: string): ParsedIcsEvent[] {
  const text = unfoldIcs(ics.replace(/^\uFEFF/, ''));
  const lines = text.split(/\r\n|\n|\r/);
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, RawField> | null = null;
  let exdates: string[] = [];
  let inAlarm = false;
  let reminder: number | undefined;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      exdates = [];
      reminder = undefined;
      continue;
    }
    if (line === 'BEGIN:VALARM') {
      inAlarm = true;
      continue;
    }
    if (line === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const parsed = veventToParsed(current);
        if (parsed) {
          if (current.RRULE) parsed.rrule = current.RRULE.value.trim().toUpperCase();
          if (exdates.length) parsed.exdates = exdates;
          if (current.COLOR) parsed.color = current.COLOR.value.trim();
          if (reminder !== undefined) parsed.reminderMinutes = reminder;
          events.push(parsed);
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const left = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const [name, ...paramParts] = left.split(';');
    const key = name.toUpperCase();
    if (inAlarm) {
      if (key === 'TRIGGER' && reminder === undefined) reminder = parseTrigger(value);
      continue;
    }
    if (key === 'EXDATE') {
      const params = paramParts.join(';').toUpperCase();
      for (const v of value.split(',')) exdates.push(parseIcsDate(v, params).date);
      continue;
    }
    current[key] = {
      params: paramParts.join(';').toUpperCase(),
      value,
    };
  }

  return events;
}
