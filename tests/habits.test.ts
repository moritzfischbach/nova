import { describe, expect, it } from 'vitest';
import { completionRate, frequencyLabel, isDueOn, isoWeekday, lastDays, monthCells, parseWeekdays, streak, toggleCompletion, weekCount, weekStart } from '../src/modules/habits/logic';
import { findHabitByName } from '../src/modules/habits/repo';
import { habitFrequencyFromArgs, describeToolCall } from '../src/modules/chat/tools';
import { formatContext } from '../src/modules/chat/context';
import { planReminders } from '../src/shared/reminderPlan';
import type { Habit } from '../src/types';

const T = '2026-11-12'; // Donnerstag
const habit = (o: Partial<Habit>): Habit => ({ id: 'h', name: 'Wasser', emoji: '💧', frequency: { type: 'daily' }, color: '#d8c39a', completions: [], createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '', ...o });

describe('Gewohnheiten – Kalenderlogik', () => {
  it('ISO weekdays and week start (Monday)', () => {
    expect(isoWeekday(T)).toBe(4);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(weekStart(T)).toBe('2026-11-09');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
  });
  it('labels frequencies in German', () => {
    expect(frequencyLabel({ type: 'daily' })).toBe('Täglich');
    expect(frequencyLabel({ type: 'weekdays', days: [1, 2, 3, 4, 5] })).toBe('Werktags');
    expect(frequencyLabel({ type: 'weekdays', days: [1, 3, 5] })).toBe('Mo, Mi, Fr');
    expect(frequencyLabel({ type: 'perWeek', times: 3 })).toBe('3× pro Woche');
  });
  it('due today: weekdays and per-week quota', () => {
    expect(isDueOn(habit({ frequency: { type: 'weekdays', days: [1, 3] } }), T)).toBe(false);
    expect(isDueOn(habit({ frequency: { type: 'weekdays', days: [4] } }), T)).toBe(true);
    const pw = habit({ frequency: { type: 'perWeek', times: 2 }, completions: ['2026-11-09', '2026-11-10'] });
    expect(weekCount(pw, T)).toBe(2);
    expect(isDueOn(pw, T)).toBe(false);
    expect(isDueOn({ ...pw, completions: [...pw.completions, T] }, T)).toBe(true); // done today stays visible
  });
});

describe('Gewohnheiten – Serien und Quoten', () => {
  it('daily streak; an open today does not break it', () => {
    const h = habit({ completions: ['2026-11-09', '2026-11-10', '2026-11-11'] });
    expect(streak(h, T)).toEqual({ current: 3, longest: 3, unit: 'Tag' });
    expect(streak({ ...h, completions: [...h.completions, T] }, T).current).toBe(4);
  });
  it('a missed day resets current but keeps the record', () => {
    const h = habit({ completions: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-10', '2026-11-11'] });
    expect(streak(h, T)).toEqual({ current: 2, longest: 4, unit: 'Tag' });
  });
  it('weekday streak skips unscheduled days', () => {
    // Mo/Mi/Fr – Fr 06., Mo 09., Mi 11. erledigt; Do 12. nicht geplant
    const h = habit({ frequency: { type: 'weekdays', days: [1, 3, 5] }, completions: ['2026-11-06', '2026-11-09', '2026-11-11'] });
    expect(streak(h, T).current).toBe(3);
  });
  it('per-week streak counts weeks', () => {
    const h = habit({ frequency: { type: 'perWeek', times: 2 }, completions: ['2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05', '2026-11-10'] });
    // KW 44 + KW 45 erfüllt, laufende Woche noch nicht → 2
    expect(streak(h, T)).toMatchObject({ current: 2, unit: 'Woche' });
    expect(streak({ ...h, completions: [...h.completions, T] }, T).current).toBe(3);
  });
  it('completion rate ignores days before the habit existed and an open today', () => {
    const h = habit({ createdAt: '2026-11-09T07:00:00.000Z', completions: ['2026-11-09', '2026-11-11'] });
    expect(completionRate(h, '2026-11-06', T)).toBeCloseTo(2 / 3);
    expect(completionRate({ ...h, completions: [...h.completions, T] }, '2026-11-06', T)).toBeCloseTo(3 / 4);
  });
  it('heatmaps: 7-day strip and Monday-based month grid', () => {
    const h = habit({ completions: [T] });
    const strip = lastDays(h, T, 7);
    expect(strip).toHaveLength(7);
    expect(strip[6]).toMatchObject({ date: T, done: true });
    const cells = monthCells(h, 2026, 10, T);
    expect(cells[0].date).toBe('2026-10-26'); // Montag vor dem 1.11.
    expect(cells.length % 7).toBe(0);
    expect(cells.find((c) => c.date === '2026-11-20')?.future).toBe(true);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });
  it('toggles completions uniquely and sorted', () => {
    expect(toggleCompletion(['2026-11-11'], '2026-11-10')).toEqual(['2026-11-10', '2026-11-11']);
    expect(toggleCompletion(['2026-11-10', '2026-11-11'], '2026-11-10')).toEqual(['2026-11-11']);
  });
});

describe('Gewohnheiten – Chat-Werkzeuge', () => {
  it('parses German weekdays', () => {
    expect(parseWeekdays('Mo, Mi, Fr')).toEqual([1, 3, 5]);
    expect(parseWeekdays(['Sa', 'So', 'montag'])).toEqual([1, 6, 7]);
  });
  it('derives the frequency leniently', () => {
    expect(habitFrequencyFromArgs({ haeufigkeit: 'taeglich' })).toEqual({ type: 'daily' });
    expect(habitFrequencyFromArgs({ haeufigkeit: 'pro_woche', mal_pro_woche: 3 })).toEqual({ type: 'perWeek', times: 3 });
    expect(habitFrequencyFromArgs({ haeufigkeit: 'wochentage', wochentage: ['Mo', 'Do'] })).toEqual({ type: 'weekdays', days: [1, 4] });
    expect(habitFrequencyFromArgs({ wochentage: 'Di,Do' })).toEqual({ type: 'weekdays', days: [2, 4] });
    expect(habitFrequencyFromArgs({ mal_pro_woche: 2 })).toEqual({ type: 'perWeek', times: 2 });
    expect(habitFrequencyFromArgs({ haeufigkeit: 'pro_woche', mal_pro_woche: 7 })).toEqual({ type: 'daily' });
    expect(habitFrequencyFromArgs({})).toEqual({ type: 'daily' });
  });
  it('describes habit tools for the confirmation card', () => {
    expect(describeToolCall({ name: 'gewohnheit_anlegen', arguments: '{"name":"Sport","emoji":"🏃","haeufigkeit":"pro_woche","mal_pro_woche":3,"erinnerung":"18:00"}' })).toBe('🏃 „Sport“ · 3× pro Woche · Erinnerung 18:00');
    expect(describeToolCall({ name: 'gewohnheit_abhaken', arguments: '{"name":"Wasser"}' })).toBe('„Wasser“ erledigt · heute');
  });
  it('finds habits by fuzzy name', () => {
    const list = [habit({ id: 'a', name: 'Wasser trinken' }), habit({ id: 'b', name: '10 Minuten lesen' })];
    expect(findHabitByName(list, 'wasser')?.id).toBe('a');
    expect(findHabitByName(list, 'Lesen')?.id).toBe('b');
    expect(findHabitByName(list, 'Yoga')).toBeUndefined();
  });
  it('adds habits to the chat context', () => {
    const text = formatContext({ today: T, todos: [], lists: [], instances: [], month: { label: 'November 2026', expenses: 0, income: 0, byCategory: [] }, goals: [], habits: [habit({ completions: ['2026-11-11'] })] });
    expect(text).toContain('Gewohnheiten (1):');
    expect(text).toContain('💧 Wasser (Täglich): heute offen, Serie 1 Tage');
  });
});

describe('Erinnerungen für Gewohnheiten und Morgen', () => {
  const now = new Date(2026, 10, 12, 6, 0);
  it('plans a wake-up brief per day and habit reminders only on due, open days', () => {
    const r = planReminders(
      {
        events: [],
        todos: [],
        goals: [],
        morning: { wakeTime: '06:30', remind: true, routine: [], checks: {} },
        habits: [habit({ reminderTime: '20:00', frequency: { type: 'weekdays', days: [4, 5] }, completions: [T] })],
      },
      now,
    );
    const morning = r.filter((x) => x.id.startsWith('morning:'));
    expect(morning[0]).toMatchObject({ id: 'morning:2026-11-12', at: new Date(2026, 10, 12, 6, 30).toISOString(), url: '#/morgen?quiz=1' });
    expect(morning).toHaveLength(15);
    const hab = r.filter((x) => x.id.startsWith('habit:'));
    expect(hab[0].id).toBe('habit:h:2026-11-13'); // today already done, next is Friday
    expect(hab.every((x) => [4, 5].includes(isoWeekday(x.id.slice(-10))))).toBe(true);
  });
  it('no morning reminder when switched off', () => {
    expect(planReminders({ events: [], todos: [], goals: [], morning: { wakeTime: '07:00', remind: false, routine: [], checks: {} } }, now)).toEqual([]);
  });
});
