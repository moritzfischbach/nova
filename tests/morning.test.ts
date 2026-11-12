import { describe, expect, it } from 'vitest';
import { budgetStatus, buildPlanPrompt, DEFAULT_MORNING, dueTodos, habitsToday, normalizeConfig, pruneChecks, routineProgress, sortRoutine, toggleRoutineCheck } from '../src/modules/morning/logic';
import type { Habit, MorningConfig, TodoItem } from '../src/types';

const T = '2026-11-12';
const todo = (o: Partial<TodoItem>): TodoItem => ({ id: 't', listId: 'l', title: 'X', done: false, createdAt: '', ...o });
const habit = (o: Partial<Habit>): Habit => ({ id: 'h', name: 'Lesen', emoji: '📖', frequency: { type: 'daily' }, color: '#fff', completions: [], createdAt: '2026-11-01T00:00:00Z', updatedAt: '', ...o });

describe('Morgenplaner', () => {
  it('normalizes stored config with defaults', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_MORNING);
    const c = normalizeConfig({ wakeTime: '6:00', remind: true, routine: [{ id: 'a', title: '  Kaffee ', time: '06:10' }, { id: 'b', title: '' }], budget: -5 });
    expect(c.wakeTime).toBe('07:00');
    expect(c.remind).toBe(true);
    expect(c.routine).toEqual([{ id: 'a', title: 'Kaffee', time: '06:10' }]);
    expect(c.budget).toBeUndefined();
  });
  it('sorts routine by time, untimed last', () => {
    expect(sortRoutine([{ id: 'x', title: 'X' }, { id: 'b', title: 'B', time: '07:30' }, { id: 'a', title: 'A', time: '07:00' }]).map((r) => r.id)).toEqual(['a', 'b', 'x']);
  });
  it('checks routine items per day and prunes old days', () => {
    let c: MorningConfig = { ...DEFAULT_MORNING, checks: { '2026-10-01': ['r-wasser'] } };
    c = toggleRoutineCheck(c, T, 'r-wasser');
    c = toggleRoutineCheck(c, T, 'r-bad');
    expect(routineProgress(c, T)).toEqual({ done: 2, total: 5 });
    expect(Object.keys(c.checks)).toEqual([T]);
    c = toggleRoutineCheck(c, T, 'r-bad');
    expect(routineProgress(c, T).done).toBe(1);
    expect(pruneChecks({ '2026-11-12': [], '2026-11-11': ['a'] }, T)).toEqual({ '2026-11-11': ['a'] });
  });
  it('lists due and overdue todos, overdue first', () => {
    const list = dueTodos([todo({ id: 'a', dueDate: T, dueTime: '10:00' }), todo({ id: 'b', dueDate: '2026-11-10' }), todo({ id: 'c', dueDate: '2026-11-13' }), todo({ id: 'd', dueDate: T, done: true }), todo({ id: 'e' })], T);
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
  });
  it('shows only habits due today', () => {
    expect(habitsToday([habit({ id: 'a' }), habit({ id: 'b', frequency: { type: 'weekdays', days: [1] } }), habit({ id: 'c', archived: true })], T).map((h) => h.id)).toEqual(['a']);
  });
  it('computes budget status', () => {
    const b = budgetStatus(900, 300, T); // 12. von 30 Tagen
    expect(b).toMatchObject({ left: 600, daysLeft: 19, over: false, ahead: false });
    expect(b.perDay).toBeCloseTo(31.57, 2);
    expect(budgetStatus(900, 600, T).ahead).toBe(true);
    expect(budgetStatus(900, 950, T)).toMatchObject({ over: true, perDay: 0, left: -50 });
  });
  it('builds the day-planning prompt for Nova', () => {
    const p = buildPlanPrompt({
      date: T,
      weekday: 'Donnerstag',
      wakeTime: '06:45',
      events: [{ title: 'Team-Call', start: '10:00', end: '10:30', allDay: false }],
      todos: [todo({ title: 'Steuer', dueDate: '2026-11-10' }), todo({ title: 'Angebot', dueDate: T, dueTime: '16:00' })],
      habits: [habit({ reminderTime: '21:00' }), habit({ id: 'x', name: 'Wasser', completions: [T] })],
      routine: [{ id: 'a', title: 'Kaffee', time: '07:00' }],
    });
    expect(p).toContain('Donnerstag, 2026-11-12');
    expect(p).toContain('06:45 Uhr');
    expect(p).toContain('10:00–10:30 Team-Call');
    expect(p).toContain('Steuer (überfällig)');
    expect(p).toContain('Angebot (bis 16:00)');
    expect(p).toContain('Lesen (Täglich, gern um 21:00)');
    expect(p).not.toContain('Wasser');
    expect(p).toContain('termin_anlegen');
    expect(p).toContain('07:00 Kaffee');
  });
  it('plans from now on when the morning is already over', () => {
    const p = buildPlanPrompt({ date: T, weekday: 'Donnerstag', wakeTime: '06:45', now: '11:20', events: [], todos: [], habits: [], routine: [{ id: 'a', title: 'Kaffee', time: '07:00' }] });
    expect(p).toContain('es ist schon 11:20 Uhr, also bitte erst ab jetzt planen');
    expect(p).not.toContain('Kaffee');
  });
});
