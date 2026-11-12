/** Pure habit logic (unit-tested): schedules, streaks, rates, heatmaps. Dates are local ISO (YYYY-MM-DD). */
import { addDays, parseLocalDate } from '../../shared/dates';
import type { Habit, HabitFrequency } from '../../types';

export const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** 1 = Montag … 7 = Sonntag */
export function isoWeekday(date: string): number {
  return ((parseLocalDate(date).getDay() + 6) % 7) + 1;
}

export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

const doneSet = (h: Pick<Habit, 'completions'>) => new Set(h.completions);

export function isDone(h: Pick<Habit, 'completions'>, date: string): boolean {
  return h.completions.includes(date);
}

/** Days the habit is planned for (perWeek: every day is allowed). */
export function isScheduled(f: HabitFrequency, date: string): boolean {
  if (f.type === 'weekdays') return f.days.includes(isoWeekday(date));
  return true;
}

export function weekCount(h: Pick<Habit, 'completions'>, date: string): number {
  const start = weekStart(date);
  const end = addDays(start, 6);
  return h.completions.filter((d) => d >= start && d <= end).length;
}

/** Should it show up as "heute dran"? */
export function isDueOn(h: Pick<Habit, 'frequency' | 'completions'>, date: string): boolean {
  if (h.frequency.type === 'perWeek') return isDone(h, date) || weekCount(h, date) < h.frequency.times;
  return isScheduled(h.frequency, date);
}

export function frequencyLabel(f: HabitFrequency): string {
  if (f.type === 'daily') return 'Täglich';
  if (f.type === 'perWeek') return `${f.times}× pro Woche`;
  const days = [...f.days].sort();
  if (days.join() === '1,2,3,4,5') return 'Werktags';
  if (days.join() === '6,7') return 'Am Wochenende';
  return days.map((d) => WEEKDAY_SHORT[d - 1]).join(', ');
}

export interface Streak {
  current: number;
  longest: number;
  unit: 'Tag' | 'Woche';
}

function startDate(h: Pick<Habit, 'completions' | 'createdAt'>): string {
  const created = h.createdAt.slice(0, 10);
  const first = [...h.completions].sort()[0];
  return first && first < created ? first : created;
}

export function streak(h: Pick<Habit, 'frequency' | 'completions' | 'createdAt'>, today: string): Streak {
  const done = doneSet(h);
  const from = startDate(h);
  if (h.frequency.type === 'perWeek') {
    const times = h.frequency.times;
    const met = (ws: string) => weekCount(h, ws) >= times;
    // current: this week counts if already met, otherwise start with last week
    let current = 0;
    let ws = weekStart(today);
    if (!met(ws)) ws = addDays(ws, -7);
    while (ws >= weekStart(from) && met(ws)) {
      current += 1;
      ws = addDays(ws, -7);
    }
    let longest = 0;
    let run = 0;
    for (let w = weekStart(from); w <= weekStart(today); w = addDays(w, 7)) {
      run = met(w) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return { current, longest: Math.max(longest, current), unit: 'Woche' };
  }
  const f = h.frequency;
  let current = 0;
  let d = today;
  // today not done yet does not break the streak
  if (isScheduled(f, d) && !done.has(d)) d = addDays(d, -1);
  for (let guard = 0; guard < 3660 && d >= from; guard += 1, d = addDays(d, -1)) {
    if (!isScheduled(f, d)) continue;
    if (!done.has(d)) break;
    current += 1;
  }
  let longest = 0;
  let run = 0;
  for (let x = from, guard = 0; x <= today && guard < 3660; x = addDays(x, 1), guard += 1) {
    if (!isScheduled(f, x)) continue;
    if (done.has(x)) {
      run += 1;
      longest = Math.max(longest, run);
    } else if (x !== today) run = 0;
  }
  return { current, longest: Math.max(longest, current), unit: 'Tag' };
}

/** Completion rate 0..1 in [from, to] (not before the habit existed; today counts only if done). */
export function completionRate(h: Pick<Habit, 'frequency' | 'completions' | 'createdAt'>, from: string, to: string): number {
  const begin = from < startDate(h) ? startDate(h) : from;
  if (begin > to) return 0;
  const done = doneSet(h);
  if (h.frequency.type === 'perWeek') {
    const times = h.frequency.times;
    let got = 0;
    let want = 0;
    for (let ws = weekStart(begin); ws <= to; ws = addDays(ws, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d >= begin && d <= to);
      const target = Math.max(1, Math.round((times * days.length) / 7));
      got += Math.min(target, days.filter((d) => done.has(d)).length);
      want += target;
    }
    return want ? got / want : 0;
  }
  let planned = 0;
  let hit = 0;
  for (let d = begin, guard = 0; d <= to && guard < 3660; d = addDays(d, 1), guard += 1) {
    if (!isScheduled(h.frequency, d)) continue;
    if (d === to && !done.has(d)) continue; // today still open
    planned += 1;
    if (done.has(d)) hit += 1;
  }
  return planned ? hit / planned : 0;
}

export interface HeatCell {
  date: string;
  done: boolean;
  scheduled: boolean;
  future: boolean;
  inMonth?: boolean;
}

export function lastDays(h: Pick<Habit, 'frequency' | 'completions'>, today: string, n = 7): HeatCell[] {
  const done = doneSet(h);
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1)).map((date) => ({ date, done: done.has(date), scheduled: isScheduled(h.frequency, date), future: false }));
}

/** Monday-based month grid (5–6 weeks) for the heatmap. */
export function monthCells(h: Pick<Habit, 'frequency' | 'completions'>, year: number, monthIndex: number, today: string): HeatCell[] {
  const done = doneSet(h);
  const first = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const start = weekStart(first);
  const cells: HeatCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i);
    const inMonth = parseLocalDate(date).getMonth() === monthIndex;
    if (i === 35 && !inMonth) break;
    cells.push({ date, done: done.has(date), scheduled: isScheduled(h.frequency, date), future: date > today, inMonth });
  }
  return cells;
}

/** Toggle done state for a day (returns new completions, sorted, unique). */
export function toggleCompletion(completions: string[], date: string): string[] {
  const set = new Set(completions);
  if (set.has(date)) set.delete(date);
  else set.add(date);
  return [...set].sort();
}

/** Lenient German parsing for chat tools: "Mo, Mi, Fr" → [1,3,5]. */
export function parseWeekdays(input: unknown): number[] {
  const list = Array.isArray(input) ? input.map(String) : typeof input === 'string' ? input.split(/[,\s/]+/) : [];
  const map: Record<string, number> = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 };
  const out = new Set<number>();
  for (const raw of list) {
    const k = raw.trim().toLowerCase().slice(0, 2);
    if (map[k]) out.add(map[k]);
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n);
  }
  return [...out].sort();
}
