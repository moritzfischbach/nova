import { describe, expect, it } from 'vitest';
import { planReminders } from '../src/shared/reminderPlan';
import type { CalendarEvent, Goal, TodoItem } from '../src/types';

const now = new Date(2026, 10, 12, 8, 0); // 12.11.2026 08:00 local
const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({ id: 'e', uid: 'e@n', title: 'Termin', date: '2026-11-12', allDay: false, startTime: '10:00', endTime: '11:00', createdAt: '', updatedAt: '', ...o });
const local = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

describe('planReminders', () => {
  it('event reminder N minutes before start', () => {
    const r = planReminders({ events: [ev({ reminderMinutes: 10 })], todos: [], goals: [] }, now);
    expect(r).toEqual([expect.objectContaining({ id: 'e:2026-11-12'.replace('e:', 'event:e:'), at: local(2026, 11, 12, 9, 50), title: 'Termin', url: '#/kalender' })]);
    expect(r[0].body).toContain('in 10 Minuten');
  });
  it('1 hour and 1 day before', () => {
    const r = planReminders({ events: [ev({ id: 'a', date: '2026-11-14', reminderMinutes: 60 }), ev({ id: 'b', date: '2026-11-14', reminderMinutes: 1440 })], todos: [], goals: [] }, now);
    expect(r.map((x) => x.at)).toEqual([local(2026, 11, 13, 10), local(2026, 11, 14, 9)]);
  });
  it('skips events without reminder and past reminders', () => {
    const r = planReminders({ events: [ev({}), ev({ id: 'p', startTime: '08:05', reminderMinutes: 10 })], todos: [], goals: [] }, now);
    expect(r).toHaveLength(0);
  });
  it('expands recurring events within the horizon', () => {
    const r = planReminders({ events: [ev({ rrule: 'FREQ=WEEKLY', reminderMinutes: 0 })], todos: [], goals: [] }, now, 30);
    expect(r.map((x) => x.id)).toEqual(['event:e:2026-11-12', 'event:e:2026-11-19', 'event:e:2026-11-26', 'event:e:2026-12-03', 'event:e:2026-12-10']);
  });
  it('all-day event reminds at 09:00 (day before for 1 day)', () => {
    const r = planReminders({ events: [ev({ allDay: true, date: '2026-11-20', reminderMinutes: 1440 })], todos: [], goals: [] }, now);
    expect(r[0].at).toBe(local(2026, 11, 19, 9));
  });
  it('todos with due date/time and remind flag', () => {
    const todos: TodoItem[] = [
      { id: 't1', listId: 'l', title: 'Steuer', done: false, createdAt: '', dueDate: '2026-11-13', dueTime: '17:30', remind: true },
      { id: 't2', listId: 'l', title: 'Ohne Zeit', done: false, createdAt: '', dueDate: '2026-11-13', remind: true },
      { id: 't3', listId: 'l', title: 'Kein Remind', done: false, createdAt: '', dueDate: '2026-11-13' },
      { id: 't4', listId: 'l', title: 'Erledigt', done: true, createdAt: '', dueDate: '2026-11-13', remind: true },
    ];
    const r = planReminders({ events: [], todos, goals: [] }, now);
    expect(r.map((x) => [x.id, x.at])).toEqual([['todo:t2', local(2026, 11, 13, 9)], ['todo:t1', local(2026, 11, 13, 17, 30)]]);
  });
  it('goal deadlines: day before and on the day at 09:00, only open goals', () => {
    const goals: Goal[] = [
      { id: 'g1', kind: 'spar', title: 'Urlaub', targetDate: '2026-12-01', status: 'offen', targetAmount: 1000, deposits: [], color: '#000', createdAt: '', updatedAt: '' },
      { id: 'g2', kind: 'allgemein', title: 'Fertig', targetDate: '2026-12-01', status: 'erreicht', deposits: [], color: '#000', createdAt: '', updatedAt: '' },
    ];
    const r = planReminders({ events: [], todos: [], goals }, now);
    expect(r.map((x) => [x.id, x.at, x.url])).toEqual([
      ['goal:g1:1d', local(2026, 11, 30, 9), '#/ziele?id=g1'],
      ['goal:g1:0d', local(2026, 12, 1, 9), '#/ziele?id=g1'],
    ]);
  });
  it('respects the horizon', () => {
    const r = planReminders({ events: [ev({ date: '2027-03-01', reminderMinutes: 10 })], todos: [], goals: [] }, now, 30);
    expect(r).toHaveLength(0);
  });
});
