import { describe, expect, it } from 'vitest';
import { BRAIN_KINDS, brainQuestion, buildQuiz, rng, type ChoiceQuestion } from '../src/modules/morning/quiz';
import {
  fromMin, isEarly, leaveTimeFor, motivation, normalizeWakeGoal, normalizeWork, pendingCheckin, punctualStreak, targetWakeFor, toMin,
  wakeCell, wakeContextLines, wakePlanInfo, wakeStats, wakeStreak, weekGrid, workCell,
} from '../src/modules/morning/wake';
import { normalizeConfig } from '../src/modules/morning/logic';
import { formatContext } from '../src/modules/chat/context';
import { planReminders } from '../src/shared/reminderPlan';
import type { MorningConfig, WakeLog, WorkConfig } from '../src/types';

const T = '2026-11-12'; // Donnerstag
const work: WorkConfig = { days: { 1: { start: '08:30', travel: 30 }, 2: { start: '08:30', travel: 30 }, 3: { start: '08:30', travel: 30 }, 4: { start: '08:30', travel: 25 }, 5: { start: '08:00', travel: 30 } }, leaveRemind: true, leaveLead: 10, checkinTime: '18:30' };
const base: MorningConfig = { wakeTime: '07:00', remind: true, routine: [], checks: {} };
const log = (date: string, o: Partial<WakeLog>): WakeLog => ({ date, ...o });

describe('Zeiten', () => {
  it('converts HH:MM', () => {
    expect(toMin('06:45')).toBe(405);
    expect(fromMin(405)).toBe('06:45');
    expect(fromMin(-15)).toBe('23:45');
  });
  it('on time within 10 minutes of the target or earlier', () => {
    expect(isEarly('06:40', '06:45')).toBe(true);
    expect(isEarly('06:55', '06:45')).toBe(true);
    expect(isEarly('06:56', '06:45')).toBe(false);
  });
});

describe('Ziel „Früher aufstehen“', () => {
  const gradual: MorningConfig = { ...base, wakeGoal: { goal: '06:30', gradual: true, start: '07:10', startDate: '2026-11-01', stepMinutes: 10, everyDays: 7 } };
  it('steps 10 minutes earlier per week until the goal', () => {
    expect(targetWakeFor(gradual, '2026-11-01')).toBe('07:10');
    expect(targetWakeFor(gradual, '2026-11-07')).toBe('07:10');
    expect(targetWakeFor(gradual, '2026-11-08')).toBe('07:00');
    expect(targetWakeFor(gradual, T)).toBe('07:00');
    expect(targetWakeFor(gradual, '2026-11-15')).toBe('06:50');
    expect(targetWakeFor(gradual, '2026-12-31')).toBe('06:30'); // never earlier than the goal
  });
  it('describes the next step', () => {
    expect(wakePlanInfo(gradual, T)).toEqual({ target: '07:00', goal: '06:30', reached: false, next: { date: '2026-11-15', time: '06:50' }, stepsLeft: 3 });
    expect(wakePlanInfo(gradual, '2026-12-31')).toMatchObject({ reached: true, stepsLeft: 0 });
  });
  it('without plan: goal, or the normal wake time', () => {
    expect(targetWakeFor({ ...base, wakeGoal: { ...gradual.wakeGoal!, gradual: false } }, T)).toBe('06:30');
    expect(targetWakeFor(base, T)).toBe('07:00');
  });
  it('normalizes stored settings', () => {
    expect(normalizeWakeGoal({ goal: '6:30' })).toBeUndefined();
    expect(normalizeWakeGoal({ goal: '06:30', gradual: true, stepMinutes: 500 })).toMatchObject({ goal: '06:30', gradual: false, stepMinutes: 10, everyDays: 7 });
    expect(normalizeWork({ days: { 1: { start: '08:00', travel: 20 }, 9: { start: '08:00', travel: 1 }, 2: { start: 'x', travel: 3 } }, leaveLead: 999 })).toEqual({ days: { 1: { start: '08:00', travel: 20 } }, leaveRemind: false, leaveLead: 10, checkinTime: undefined });
    expect(normalizeConfig({ ...base, work, wakeGoal: gradual.wakeGoal, linkHabits: true })).toMatchObject({ work, wakeGoal: gradual.wakeGoal, linkHabits: true });
  });
});

describe('Pünktlich zur Arbeit', () => {
  it('leave time = start − travel, per weekday', () => {
    expect(leaveTimeFor(work, T)).toBe('08:05');
    expect(leaveTimeFor(work, '2026-11-13')).toBe('07:30');
    expect(leaveTimeFor(work, '2026-11-14')).toBeUndefined();
  });
  it('asks „Warst du pünktlich?“ after work started, otherwise for the last work day', () => {
    expect(pendingCheckin({}, work, T, '08:00')).toBe('2026-11-11');
    expect(pendingCheckin({}, work, T, '09:00')).toBe(T);
    expect(pendingCheckin({ [T]: log(T, { punctual: 'ja' }) }, work, T, '19:00')).toBeUndefined();
    expect(pendingCheckin({ '2026-11-13': log('2026-11-13', { punctual: 'ja' }) }, work, '2026-11-16', '07:00')).toBeUndefined(); // Monday morning, Friday answered
    expect(pendingCheckin({}, work, '2026-11-16', '07:00')).toBe('2026-11-13');
    expect(pendingCheckin({}, undefined, T, '09:00')).toBeUndefined();
  });
  it('punctuality streak over work days; knapp counts, the latest unanswered day does not break it', () => {
    const logs = {
      '2026-11-06': log('2026-11-06', { punctual: 'spaet' }),
      '2026-11-09': log('2026-11-09', { punctual: 'ja' }),
      '2026-11-10': log('2026-11-10', { punctual: 'knapp' }),
      '2026-11-11': log('2026-11-11', { punctual: 'ja' }),
    };
    expect(punctualStreak(logs, work, T)).toBe(3);
    expect(punctualStreak({ ...logs, [T]: log(T, { punctual: 'ja' }) }, work, T)).toBe(4);
    expect(punctualStreak({ ...logs, [T]: log(T, { punctual: 'spaet' }) }, work, T)).toBe(0);
  });
});

describe('Serien, Wochenansicht, Quoten', () => {
  const logs: Record<string, WakeLog> = {
    '2026-11-09': log('2026-11-09', { early: true, wokeAt: '06:50', punctual: 'ja' }),
    '2026-11-10': log('2026-11-10', { early: false, wokeAt: '07:20', punctual: 'spaet' }),
    '2026-11-11': log('2026-11-11', { early: true, wokeAt: '06:45', punctual: 'ja' }),
  };
  it('early-rising streak (today counts once logged)', () => {
    expect(wakeStreak(logs, T)).toBe(1);
    expect(wakeStreak({ ...logs, [T]: log(T, { early: true }) }, T)).toBe(2);
    expect(wakeStreak({ ...logs, [T]: log(T, { early: false }) }, T)).toBe(0);
  });
  it('week cells for the heatmap', () => {
    const week = weekGrid(T, 1);
    expect(week[0]).toBe('2026-11-09');
    expect(week.map((d) => wakeCell(logs, d, T).state)).toEqual(['on', 'miss', 'on', 'none', 'future', 'future', 'future']);
    expect(week.map((d) => workCell(logs, work, d, T).state)).toEqual(['on', 'miss', 'on', 'none', 'future', 'off', 'off']);
    expect(weekGrid(T, 4)).toHaveLength(28);
  });
  it('14-day rates', () => {
    expect(wakeStats(logs, work, T)).toMatchObject({ early: { hit: 2, of: 3 }, punctual: { hit: 2, of: 3 }, wakeStreak: 1, punctualStreak: 1 });
  });
  it('motivating line', () => {
    expect(motivation(true, 5, T)).toBe('5 Tage in Folge früh auf – du bist auf Kurs.');
    expect(motivation(true, 7, T)).toContain('ganze Woche');
    expect(motivation(false, 0, T).length).toBeGreaterThan(10);
  });
  it('chat context knows wake and punctuality stats', () => {
    const config: MorningConfig = { ...base, work, dailyQuiz: true, wakeGoal: { goal: '06:30', gradual: true, start: '07:10', startDate: '2026-11-01', stepMinutes: 10, everyDays: 7 } };
    const lines = wakeContextLines(config, { ...logs, [T]: log(T, { wokeAt: '07:15', early: false, focus: 'Angebot' }) }, T);
    expect(lines[0]).toBe('Aufstehen: Ziel heute 07:00 (Endziel 06:30, 3 Schritte à 10 Min.); heute um 07:15 aufgestanden (15 Min. zu spät); letzte 14 Tage 2/4 pünktlich auf, Serie 0 Tage. Fokus heute: Angebot.');
    expect(lines[1]).toBe('Arbeit: heute Beginn 08:30, 25 Min. Weg, losgehen 08:05; pünktlich 2/3 Arbeitstage (14 Tage), Serie 1.');
    const text = formatContext({ today: T, todos: [], lists: [], instances: [], month: { label: 'November', expenses: 0, income: 0, byCategory: [] }, goals: [], wake: { config, logs } });
    expect(text.startsWith('Aufstehen: Ziel heute 07:00')).toBe(true);
  });
});

describe('Wach-Quiz', () => {
  it('every brain task has 4 unique options and a valid answer', () => {
    for (let seed = 1; seed < 400; seed += 1) {
      const r = rng(seed);
      for (const kind of BRAIN_KINDS) {
        const q = brainQuestion(r, kind, 'x');
        expect(new Set(q.options).size, `${kind} ${seed} ${q.options}`).toBe(4);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(4);
      }
    }
  });
  it('math answers are correct', () => {
    for (let seed = 1; seed < 200; seed += 1) {
      const q = brainQuestion(rng(seed), 'rechnen', 'x');
      const [a, op, b] = q.prompt.replace(' = ?', '').split(' ');
      const right = op === '+' ? Number(a) + Number(b) : op === '−' ? Number(a) - Number(b) : Number(a) * Number(b);
      expect(q.options[q.answer]).toBe(String(right));
    }
  });
  it('memory task: the answer is the word that was not shown', () => {
    const q = brainQuestion(rng(3), 'merken', 'x');
    expect(q.memorize).toHaveLength(4);
    expect(q.memorize).not.toContain(q.options[q.answer]);
    expect(q.options.filter((o) => q.memorize!.includes(o))).toHaveLength(3);
  });
  it('three questions: wake time first, a brain task, then brain or reflection; randomized', () => {
    const prompts = new Set<string>();
    let reflections = 0;
    for (let seed = 1; seed < 60; seed += 1) {
      const quiz = buildQuiz({ seed, now: '06:52', leaveAt: '08:05' });
      expect(quiz).toHaveLength(3);
      expect(quiz[0]).toMatchObject({ type: 'time', id: 'woke', value: '06:52' });
      expect(quiz[1].type).toBe('choice');
      if (quiz[2].type !== 'choice') reflections += 1;
      else expect((quiz[2] as ChoiceQuestion).kind).not.toBe((quiz[1] as ChoiceQuestion).kind);
      prompts.add((quiz[1] as ChoiceQuestion).prompt);
    }
    expect(prompts.size).toBeGreaterThan(30);
    expect(reflections).toBeGreaterThan(10);
    expect(reflections).toBeLessThan(55);
  });
  it('avoids the brain-task kinds used yesterday', () => {
    for (let seed = 1; seed < 50; seed += 1) {
      const q = buildQuiz({ seed, now: '07:00', avoid: ['rechnen', 'reihe'] });
      expect(['rechnen', 'reihe']).not.toContain((q[1] as ChoiceQuestion).kind);
    }
  });
  it('no leave-time question without work day', () => {
    for (let seed = 1; seed < 50; seed += 1) expect(buildQuiz({ seed, now: '07:00' }).some((q) => q.id === 'leave')).toBe(false);
  });
});

describe('Mitteilungen: Wach-Quiz, Losgehen, Check-in', () => {
  const now = new Date(2026, 10, 12, 5, 0);
  const config: MorningConfig = { ...base, work, dailyQuiz: true, wakeGoal: { goal: '06:30', gradual: true, start: '07:10', startDate: '2026-11-01', stepMinutes: 10, everyDays: 7 } };
  it('wake push at the day\'s target, deep-linking to the quiz; skipped once the quiz is done', () => {
    const r = planReminders({ events: [], todos: [], goals: [], morning: config }, now);
    expect(r.find((x) => x.id === `morning:${T}`)).toMatchObject({ at: new Date(2026, 10, 12, 7, 0).toISOString(), url: '#/morgen?quiz=1' });
    expect(r.find((x) => x.id === 'morning:2026-11-16')!.at).toBe(new Date(2026, 10, 16, 6, 50).toISOString());
    const done = planReminders({ events: [], todos: [], goals: [], morning: config, wakeLogs: { [T]: log(T, { quizAt: '06:58' }) } }, now);
    expect(done.find((x) => x.id === `morning:${T}`)).toBeUndefined();
  });
  it('„Zeit loszugehen“ X minutes before leaving, work days only', () => {
    const r = planReminders({ events: [], todos: [], goals: [], morning: config }, now);
    const leave = r.find((x) => x.id === `leave:${T}`)!;
    expect(leave.at).toBe(new Date(2026, 10, 12, 7, 55).toISOString());
    expect(leave.title).toBe('Zeit loszugehen 🚶');
    expect(leave.body).toBe('In 10 Min. losgehen (08:05 Uhr) – Arbeitsbeginn 08:30 Uhr, 25 Min. Weg.');
    expect(r.some((x) => x.id === 'leave:2026-11-14')).toBe(false);
  });
  it('evening check-in unless already answered', () => {
    const r = planReminders({ events: [], todos: [], goals: [], morning: config, wakeLogs: { [T]: log(T, { punctual: 'ja' }) } }, now);
    expect(r.some((x) => x.id === `checkin:${T}`)).toBe(false);
    expect(r.find((x) => x.id === 'checkin:2026-11-13')).toMatchObject({ url: '#/morgen?checkin=2026-11-13', title: 'Warst du heute pünktlich?' });
  });
});
