/**
 * Minimal RRULE support (RFC 5545 subset):
 * FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (weekly).
 * Plus EXDATE handling via `exdates` (YYYY-MM-DD).
 */
import { addDays, formatISODate, parseLocalDate } from '../../shared/dates';
import type { CalendarEvent } from '../../types';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RRule {
  freq: Freq;
  interval: number;
  count?: number;
  /** YYYY-MM-DD (inclusive) */
  until?: string;
  byDay?: Weekday[];
}

export function parseRRule(input: string | undefined): RRule | null {
  if (!input) return null;
  const text = input.replace(/^RRULE:/i, '').trim();
  const parts = Object.fromEntries(
    text.split(';').filter(Boolean).map((p) => {
      const [k, v = ''] = p.split('=');
      return [k.toUpperCase(), v.toUpperCase()];
    }),
  );
  const freq = parts.FREQ as Freq;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const rule: RRule = { freq, interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1) };
  if (parts.COUNT) rule.count = Math.max(1, Number(parts.COUNT) || 1);
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(',').map((d: string) => d.replace(/^[+-]?\d+/, '')).filter((d: string) => (WEEKDAYS as readonly string[]).includes(d));
    if (days.length) rule.byDay = days as Weekday[];
  }
  return rule;
}

export function formatRRule(rule: RRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length && rule.freq === 'WEEKLY') parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  return parts.join(';');
}

export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[(parseLocalDate(iso).getDay() + 6) % 7];
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 86_400_000);
}

function addMonthsExact(iso: string, months: number): string | null {
  const d = parseLocalDate(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  if (day > lastDay) return null; // RFC 5545: skip invalid dates (e.g. 31st)
  target.setDate(day);
  return formatISODate(target);
}

/**
 * Occurrence start dates of a rule beginning at `start`, within [from, to] (inclusive, YYYY-MM-DD).
 * COUNT counts from the series start, not from `from`.
 */
export function occurrences(start: string, rule: RRule, from: string, to: string, limit = 1000): string[] {
  const out: string[] = [];
  let produced = 0;
  const done = (date: string) => (rule.until && date > rule.until) || (rule.count !== undefined && produced >= rule.count) || date > to;
  const push = (date: string) => {
    if (date < start) return;
    produced += 1;
    if (date >= from && date <= to) out.push(date);
  };

  if (rule.freq === 'DAILY') {
    for (let i = 0, date = start; !done(date) && out.length < limit; i += 1, date = addDays(start, i * rule.interval)) push(date);
    return out;
  }
  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.length ? rule.byDay : [weekdayOf(start)];
    const startMonday = addDays(start, -((parseLocalDate(start).getDay() + 6) % 7));
    for (let w = 0; out.length < limit; w += 1) {
      const monday = addDays(startMonday, w * 7 * rule.interval);
      if (monday > to || (rule.until && monday > rule.until)) break;
      let stop = false;
      for (const wd of WEEKDAYS) {
        if (!days.includes(wd)) continue;
        const date = addDays(monday, WEEKDAYS.indexOf(wd));
        if (date < start) continue;
        if (done(date)) {
          stop = true;
          break;
        }
        push(date);
      }
      if (stop) break;
    }
    return out;
  }
  const stepMonths = rule.freq === 'MONTHLY' ? rule.interval : rule.interval * 12;
  for (let i = 0; out.length < limit && i < 5000; i += 1) {
    const date = addMonthsExact(start, i * stepMonths);
    if (date === null) continue;
    if (done(date)) break;
    push(date);
  }
  return out;
}

export interface EventInstance {
  event: CalendarEvent;
  /** occurrence start date */
  date: string;
  /** occurrence end date (inclusive) */
  endDate: string;
  instanceId: string;
  recurring: boolean;
}

/** Expands an event (recurring or not) into instances overlapping [from, to]. */
export function expandEvent(event: CalendarEvent, from: string, to: string): EventInstance[] {
  const span = event.endDate && event.endDate > event.date ? daysBetween(event.date, event.endDate) : 0;
  const rule = parseRRule(event.rrule);
  if (!rule) {
    const end = addDays(event.date, span);
    return end >= from && event.date <= to
      ? [{ event, date: event.date, endDate: end, instanceId: event.id, recurring: false }]
      : [];
  }
  const ex = new Set(event.exdates ?? []);
  return occurrences(event.date, rule, addDays(from, -span), to)
    .filter((d) => !ex.has(d))
    .map((d) => ({ event, date: d, endDate: addDays(d, span), instanceId: `${event.id}::${d}`, recurring: true }));
}

export function expandAll(events: CalendarEvent[], from: string, to: string): EventInstance[] {
  return events
    .flatMap((e) => expandEvent(e, from, to))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.event.allDay === b.event.allDay ? (a.event.startTime ?? '').localeCompare(b.event.startTime ?? '') : a.event.allDay ? -1 : 1));
}

const FREQ_LABEL: Record<Freq, [string, string]> = {
  DAILY: ['Täglich', 'Tage'],
  WEEKLY: ['Wöchentlich', 'Wochen'],
  MONTHLY: ['Monatlich', 'Monate'],
  YEARLY: ['Jährlich', 'Jahre'],
};

export function describeRRule(input: string | undefined): string {
  const rule = parseRRule(input);
  if (!rule) return '';
  let text = rule.interval > 1 ? `Alle ${rule.interval} ${FREQ_LABEL[rule.freq][1]}` : FREQ_LABEL[rule.freq][0];
  if (rule.count) text += `, ${rule.count}×`;
  else if (rule.until) text += ` bis ${parseLocalDate(rule.until).toLocaleDateString('de-DE')}`;
  return text;
}
