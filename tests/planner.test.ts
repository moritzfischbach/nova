import { describe, expect, it } from 'vitest';
import { applyPlan, computePlan, defaultAnswers, orderActivities, refinePrompt, stepsFor, travelMinutes, type PlanAnswers } from '../src/modules/morning/planner';
import { DEFAULT_MORNING, normalizeConfig } from '../src/modules/morning/logic';
import { leaveTimeFor, targetWakeFor } from '../src/modules/morning/wake';
import { planReminders } from '../src/shared/reminderPlan';

const base = (over: Partial<PlanAnswers> = {}): PlanAnswers => ({ ...defaultAnswers(), ...over });

describe('Morgenplan-Quiz planner', () => {
  it('works backwards from arrival − travel − buffer', () => {
    // default: 08:30, 25 Min. + 10 Puffer → leave 07:55; activities 15+10+5+20+5+5 = 60, wake 10, me 10 → 80 Min.
    const p = computePlan(base());
    expect(p.leave).toBe('07:55');
    expect(p.arrival).toBe('08:20');
    expect(p.totalMinutes).toBe(80);
    expect(p.wake).toBe('06:35');
    expect(p.steps[0]).toMatchObject({ id: 'aufwachen', start: '06:35' });
    expect(p.steps.at(-1)).toMatchObject({ id: 'packen', start: '07:50', minutes: 5 });
    expect(p.bedtime).toBe('23:05');
  });

  it('orders water → movement → shower → dress → breakfast → teeth → pack', () => {
    const a = base({ activities: [
      { id: 'packen', title: 'Packen', emoji: '', minutes: 5, must: true },
      { id: 'zaehne', title: 'Zähne', emoji: '', minutes: 5, must: true },
      { id: 'fruehstueck', title: 'F', emoji: '', minutes: 15, must: true },
      { id: 'sport', title: 'Sport', emoji: '', minutes: 30, must: false },
      { id: 'duschen', title: 'D', emoji: '', minutes: 10, must: true },
      { id: 'anziehen', title: 'A', emoji: '', minutes: 5, must: true },
    ] });
    expect(stepsFor(a).map((s) => s.id)).toEqual(['aufwachen', 'sport', 'duschen', 'anziehen', 'fruehstueck', 'zaehne', 'metime', 'packen']);
    expect(orderActivities([{ id: 'eigen-x', title: 'Pflanzen', emoji: '', minutes: 5, must: false }, { id: 'zaehne', title: 'Z', emoji: '', minutes: 5, must: true }]).map((x) => x.id)).toEqual(['eigen-x', 'zaehne']);
  });

  it('derives travel from a departure time', () => {
    const a = base({ travelMode: 'abfahrt', departure: '07:40', arrive: '08:30', buffer: 10 });
    expect(travelMinutes(a)).toBe(40);
    expect(computePlan(a).leave).toBe('07:40');
  });

  it('wake time lands on a 5-minute grid, extra time goes to waking up', () => {
    const p = computePlan(base({ arrive: '08:32' }));
    expect(p.wake).toBe('06:35');
    expect(p.steps[0].minutes).toBe(12);
  });

  it('flags a packed morning and offers a compact variant without Kann items', () => {
    const a = base({ activities: [...defaultAnswers().activities, { id: 'sport', title: 'Sport / Workout', emoji: '🏃', minutes: 45, must: false }, { id: 'lesen', title: 'Lesen', emoji: '📖', minutes: 20, must: false }] });
    const p = computePlan(a);
    expect(p.totalMinutes).toBe(145);
    expect(p.packed).toBe(true);
    expect(p.compactWake).toBe('06:50');
    expect(p.dropped).toContain('Sport / Workout');
    expect(p.hints.join(' ')).toMatch(/ziemlich voll/);
    const c = computePlan(a, { compact: true });
    expect(c.steps.some((s) => s.id === 'sport' || s.id === 'metime' || s.id === 'kaffee')).toBe(false);
    expect(c.wake).toBe('06:50');
  });

  it('hints when the usual bedtime is too late', () => {
    const p = computePlan(base({ bedtime: '00:30', sleepHours: 8 }));
    expect(p.bedtime).toBe('22:35');
    expect(p.naturalWake).toBe('08:30');
    expect(p.hints.join(' ')).toMatch(/schrittweise/);
    expect(computePlan(base({ bedtime: '22:30', sleepHours: 8 })).hints.join(' ')).not.toMatch(/schrittweise/);
  });

  it('computes per-day times when start differs', () => {
    const p = computePlan(base({ sameStart: false, arriveByDay: { '1': '08:30', '5': '07:30' } }));
    expect(p.perDay.find((d) => d.day === 5)).toMatchObject({ arrive: '07:30', leave: '06:55', wake: '05:35' });
    expect(p.perDay.find((d) => d.day === 2)?.wake).toBe('06:35');
  });

  it('applyPlan sets routine, wake, work, goal and per-day offsets', () => {
    const a = base({ sameStart: false, arriveByDay: { '5': '07:30' }, bedtime: '23:00', sleepHours: 7.5 });
    const plan = computePlan(a);
    const c = normalizeConfig(applyPlan(DEFAULT_MORNING, plan, '2026-11-09'));
    expect(c.routine.map((r) => r.time)).toEqual(plan.steps.map((s) => s.start));
    expect(c.routine[0].title).toMatch(/Aufwachen/);
    expect(c.remind).toBe(true);
    expect(c.wakeTime).toBe('06:35');
    expect(c.wakeGoal).toMatchObject({ goal: '06:35', gradual: false });
    expect(c.work?.days['1']).toEqual({ start: '08:30', travel: 25, buffer: 10 });
    expect(c.work?.leaveRemind).toBe(true);
    expect(c.work?.days['6']).toBeUndefined();
    // 2026-11-13 is a Friday
    expect(targetWakeFor(c, '2026-11-13')).toBe('05:35');
    expect(targetWakeFor(c, '2026-11-10')).toBe('06:35');
    expect(leaveTimeFor(c.work, '2026-11-13')).toBe('06:55');
  });

  it('applyPlan uses a gradual goal when the user usually sleeps much longer', () => {
    const plan = computePlan(base({ bedtime: '00:00', sleepHours: 7.5 }));
    const c = applyPlan(DEFAULT_MORNING, plan, '2026-11-09');
    expect(c.wakeGoal).toMatchObject({ goal: '06:35', gradual: true, start: '07:30', stepMinutes: 10, everyDays: 7 });
    expect(c.wakeTime).toBe('07:30');
  });

  it('morning push opens the plan, not the quiz, when the daily quiz is off', () => {
    const plan = computePlan(base());
    const c = normalizeConfig(applyPlan(DEFAULT_MORNING, plan, '2026-11-09'));
    const now = new Date(2026, 10, 9, 0, 0);
    const r = planReminders({ todos: [], events: [], goals: [], habits: [], morning: c }, now);
    const m = r.find((x) => x.id === 'morning:2026-11-09');
    expect(m?.url).toBe('#/morgen');
    expect(m?.body).toMatch(/07:55/);
    const q = planReminders({ todos: [], events: [], goals: [], habits: [], morning: { ...c, dailyQuiz: true } }, now);
    expect(q.find((x) => x.id === 'morning:2026-11-09')?.url).toBe('#/morgen?quiz=1');
  });

  it('builds a refine prompt with the plan as base', () => {
    const a = base();
    const t = refinePrompt(a, computePlan(a));
    expect(t).toMatch(/Tipps/);
    expect(t).toMatch(/Aufstehen 06:35/);
    expect(t).toMatch(/losfahren 07:55/);
  });
});
