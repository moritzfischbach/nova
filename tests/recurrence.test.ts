import { describe, expect, it } from 'vitest';
import { describeRRule, expandEvent, formatRRule, occurrences, parseRRule } from '../src/modules/calendar/recurrence';
import type { CalendarEvent } from '../src/types';

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1', uid: 'e1@nova.local', title: 'T', date: '2026-11-02', allDay: false, startTime: '09:00', endTime: '10:00',
  createdAt: '', updatedAt: '', ...o,
});

describe('RRULE parse/format', () => {
  it('roundtrips', () => {
    const r = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6');
    expect(r).toEqual({ freq: 'WEEKLY', interval: 2, byDay: ['MO', 'WE'], count: 6 });
    expect(formatRRule(r!)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6');
  });
  it('parses UNTIL with time', () => {
    expect(parseRRule('FREQ=DAILY;UNTIL=20261130T225959Z')?.until).toBe('2026-11-30');
  });
  it('rejects unknown freq', () => {
    expect(parseRRule('FREQ=HOURLY')).toBeNull();
    expect(parseRRule('')).toBeNull();
  });
  it('describes in German', () => {
    expect(describeRRule('FREQ=WEEKLY')).toBe('Wöchentlich');
    expect(describeRRule('FREQ=DAILY;INTERVAL=3;COUNT=5')).toBe('Alle 3 Tage, 5×');
  });
});

describe('occurrences', () => {
  it('daily with count', () => {
    expect(occurrences('2026-11-01', { freq: 'DAILY', interval: 1, count: 3 }, '2026-01-01', '2026-12-31')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });
  it('daily interval within window, count from series start', () => {
    expect(occurrences('2026-11-01', { freq: 'DAILY', interval: 2, count: 4 }, '2026-11-04', '2026-12-31')).toEqual(['2026-11-05', '2026-11-07']);
  });
  it('weekly byday', () => {
    expect(occurrences('2026-11-02', { freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TH'] }, '2026-11-01', '2026-11-15')).toEqual(['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12']);
  });
  it('biweekly until', () => {
    expect(occurrences('2026-11-02', { freq: 'WEEKLY', interval: 2, until: '2026-12-01' }, '2026-11-01', '2027-01-01')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });
  it('monthly skips months without the day', () => {
    expect(occurrences('2026-01-31', { freq: 'MONTHLY', interval: 1 }, '2026-01-01', '2026-06-30')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });
  it('yearly (birthday)', () => {
    expect(occurrences('2020-03-15', { freq: 'YEARLY', interval: 1 }, '2026-01-01', '2027-12-31')).toEqual(['2026-03-15', '2027-03-15']);
  });
  it('yearly on Feb 29 only in leap years', () => {
    expect(occurrences('2024-02-29', { freq: 'YEARLY', interval: 1 }, '2024-01-01', '2029-01-01')).toEqual(['2024-02-29', '2028-02-29']);
  });
});

describe('expandEvent', () => {
  it('single event in range', () => {
    expect(expandEvent(ev({}), '2026-11-01', '2026-11-30')).toHaveLength(1);
    expect(expandEvent(ev({}), '2026-12-01', '2026-12-31')).toHaveLength(0);
  });
  it('multi-day event overlapping window start', () => {
    const r = expandEvent(ev({ date: '2026-10-30', endDate: '2026-11-02', allDay: true }), '2026-11-01', '2026-11-30');
    expect(r[0]).toMatchObject({ date: '2026-10-30', endDate: '2026-11-02' });
  });
  it('recurring with exdates and ids', () => {
    const r = expandEvent(ev({ rrule: 'FREQ=WEEKLY;COUNT=4', exdates: ['2026-11-09'] }), '2026-11-01', '2026-12-31');
    expect(r.map((i) => i.date)).toEqual(['2026-11-02', '2026-11-16', '2026-11-23']);
    expect(r[0].instanceId).toBe('e1::2026-11-02');
    expect(r[0].recurring).toBe(true);
  });
});
