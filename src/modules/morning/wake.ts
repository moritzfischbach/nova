/** Pure logic for „Früher aufstehen“ and „Pünktlich zur Arbeit“ (unit-tested). */
import { addDays, parseLocalDate } from '../../shared/dates';
import type { MorningConfig, Punctuality, WakeGoal, WakeLog, WorkConfig, WorkDay } from '../../types';

export const EARLY_TOLERANCE = 10;
export const LINKED_HABITS = {
  wake: { id: 'habit-frueh-aufstehen', name: 'Früh aufstehen', emoji: '⏰' },
  work: { id: 'habit-puenktlich', name: 'Pünktlich bei der Arbeit', emoji: '🕗' },
} as const;

const HHMM = /^\d{2}:\d{2}$/;
const time = (t: unknown) => (typeof t === 'string' && HHMM.test(t) ? t : undefined);

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
export function fromMin(n: number): string {
  const v = ((Math.round(n) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
export function isoWeekdayOf(date: string): number {
  return ((parseLocalDate(date).getDay() + 6) % 7) + 1;
}

export function normalizeWakeGoal(raw: unknown): WakeGoal | undefined {
  const g = raw as Partial<WakeGoal> | undefined;
  if (!g || !time(g.goal)) return undefined;
  const step = Math.round(Number(g.stepMinutes));
  const every = Math.round(Number(g.everyDays));
  return {
    goal: g.goal!,
    gradual: g.gradual === true && Boolean(time(g.start)),
    start: time(g.start) ?? g.goal!,
    startDate: typeof g.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.startDate) ? g.startDate : '2026-01-01',
    stepMinutes: step >= 1 && step <= 60 ? step : 10,
    everyDays: every >= 1 && every <= 31 ? every : 7,
  };
}

export function normalizeWork(raw: unknown): WorkConfig | undefined {
  const w = raw as Partial<WorkConfig> | undefined;
  if (!w || typeof w.days !== 'object' || !w.days) return undefined;
  const days: Record<string, WorkDay> = {};
  for (const [k, v] of Object.entries(w.days)) {
    const travel = Math.round(Number(v?.travel));
    const buffer = Math.round(Number(v?.buffer));
    if (/^[1-7]$/.test(k) && time(v?.start) && travel >= 0 && travel <= 300) days[k] = buffer > 0 && buffer <= 120 ? { start: v.start, travel, buffer } : { start: v.start, travel };
  }
  if (!Object.keys(days).length) return undefined;
  const lead = Math.round(Number(w.leaveLead));
  return { days, leaveRemind: w.leaveRemind === true, leaveLead: lead >= 0 && lead <= 120 ? lead : 10, checkinTime: time(w.checkinTime) };
}

/** Target wake time for a day: gradual plan (x min earlier every n days, never past the goal) or the goal; else the normal wake time. */
export function targetWakeFor(config: Pick<MorningConfig, 'wakeTime' | 'wakeGoal' | 'wakeByDay'>, date: string): string {
  return fromMin(toMin(baseTargetWake(config, date)) + dayOffset(config, date));
}

/** Minutes a weekday differs from the reference plan (Morgenplan-Quiz with different work starts). */
export function dayOffset(config: Pick<MorningConfig, 'wakeTime' | 'wakeGoal' | 'wakeByDay'>, date: string): number {
  const own = config.wakeByDay?.[String(isoWeekdayOf(date))];
  if (!own) return 0;
  const ref = config.wakeGoal?.goal ?? config.wakeTime;
  return toMin(own) - toMin(ref);
}

function baseTargetWake(config: Pick<MorningConfig, 'wakeTime' | 'wakeGoal'>, date: string): string {
  const g = config.wakeGoal;
  if (!g) return config.wakeTime;
  if (!g.gradual) return g.goal;
  const days = Math.max(0, Math.round((parseLocalDate(date).getTime() - parseLocalDate(g.startDate).getTime()) / 86_400_000));
  const steps = Math.floor(days / g.everyDays);
  return fromMin(Math.max(toMin(g.goal), toMin(g.start) - steps * g.stepMinutes));
}

export interface WakePlanInfo {
  target: string;
  goal: string;
  reached: boolean;
  /** next earlier step (date + time) if the plan continues */
  next?: { date: string; time: string };
  /** remaining steps until the goal */
  stepsLeft: number;
}

export function wakePlanInfo(config: Pick<MorningConfig, 'wakeTime' | 'wakeGoal'>, date: string): WakePlanInfo | undefined {
  const g = config.wakeGoal;
  if (!g) return undefined;
  const target = baseTargetWake(config, date);
  const reached = toMin(target) <= toMin(g.goal);
  if (!g.gradual || reached) return { target, goal: g.goal, reached, stepsLeft: 0 };
  const days = Math.max(0, Math.round((parseLocalDate(date).getTime() - parseLocalDate(g.startDate).getTime()) / 86_400_000));
  const nextDate = addDays(g.startDate, (Math.floor(days / g.everyDays) + 1) * g.everyDays);
  return {
    target,
    goal: g.goal,
    reached,
    next: { date: nextDate, time: baseTargetWake(config, nextDate) },
    stepsLeft: Math.ceil((toMin(target) - toMin(g.goal)) / g.stepMinutes),
  };
}

export function isEarly(wokeAt: string, target: string, tolerance = EARLY_TOLERANCE): boolean {
  return toMin(wokeAt) <= toMin(target) + tolerance;
}

/** Minutes after the target (negative = earlier). */
export function wakeDelta(wokeAt: string, target: string): number {
  return toMin(wokeAt) - toMin(target);
}

export function workDayOf(work: WorkConfig | undefined, date: string): WorkDay | undefined {
  return work?.days[String(isoWeekdayOf(date))];
}

export function leaveTimeFor(work: WorkConfig | undefined, date: string): string | undefined {
  const d = workDayOf(work, date);
  return d ? fromMin(toMin(d.start) - d.travel - (d.buffer ?? 0)) : undefined;
}

export const isPunctual = (p: Punctuality | undefined) => p === 'ja' || p === 'knapp';

/** Consecutive days (today if already logged, else from yesterday) with an on-time wake-up. */
export function wakeStreak(logs: Record<string, WakeLog>, today: string): number {
  let d = logs[today]?.early !== undefined ? today : addDays(today, -1);
  let n = 0;
  for (let guard = 0; guard < 400 && logs[d]?.early; guard += 1, d = addDays(d, -1)) n += 1;
  return n;
}

/** Consecutive work days answered „Ja“/„Knapp“. Today and an unanswered yesterday don't break it. */
export function punctualStreak(logs: Record<string, WakeLog>, work: WorkConfig | undefined, today: string): number {
  if (!work) return 0;
  let n = 0;
  let skipped = false;
  for (let i = 0, d = today; i < 400; i += 1, d = addDays(d, -1)) {
    if (!workDayOf(work, d)) continue;
    const p = logs[d]?.punctual;
    if (!p && !skipped && n === 0 && i <= 3) {
      skipped = true; // the most recent work day may still be unanswered
      continue;
    }
    if (!isPunctual(p)) break;
    n += 1;
  }
  return n;
}

export type DayState = 'on' | 'miss' | 'none' | 'off' | 'future';
export interface DayCell {
  date: string;
  state: DayState;
  label?: string;
}

export function wakeCell(logs: Record<string, WakeLog>, date: string, today: string): DayCell {
  if (date > today) return { date, state: 'future' };
  const l = logs[date];
  if (l?.early === undefined) return { date, state: 'none' };
  return { date, state: l.early ? 'on' : 'miss', label: l.wokeAt };
}

export function workCell(logs: Record<string, WakeLog>, work: WorkConfig | undefined, date: string, today: string): DayCell {
  if (date > today) return { date, state: workDayOf(work, date) ? 'future' : 'off' };
  if (!workDayOf(work, date)) return { date, state: 'off' };
  const p = logs[date]?.punctual;
  if (!p) return { date, state: 'none' };
  return { date, state: isPunctual(p) ? 'on' : 'miss', label: p };
}

/** Monday-based weeks (oldest first) ending with the current week. */
export function weekGrid(today: string, weeks: number): string[] {
  const monday = addDays(today, 1 - isoWeekdayOf(today));
  const start = addDays(monday, -7 * (weeks - 1));
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

export interface WakeStats {
  wakeStreak: number;
  punctualStreak: number;
  /** last 14 days */
  early: { hit: number; of: number };
  punctual: { hit: number; of: number };
}

export function wakeStats(logs: Record<string, WakeLog>, work: WorkConfig | undefined, today: string, days = 14): WakeStats {
  const range = Array.from({ length: days }, (_, i) => addDays(today, -i));
  const wl = range.map((d) => logs[d]).filter((l) => l?.early !== undefined);
  const pl = range.filter((d) => workDayOf(work, d) && logs[d]?.punctual);
  return {
    wakeStreak: wakeStreak(logs, today),
    punctualStreak: punctualStreak(logs, work, today),
    early: { hit: wl.filter((l) => l!.early).length, of: wl.length },
    punctual: { hit: pl.filter((d) => isPunctual(logs[d].punctual)).length, of: pl.length },
  };
}

/** Work day that still needs „Warst du pünktlich?“: today after work started, else the last work day (≤ 3 days back). */
export function pendingCheckin(logs: Record<string, WakeLog>, work: WorkConfig | undefined, today: string, nowHHMM: string): string | undefined {
  if (!work) return undefined;
  const t = workDayOf(work, today);
  if (logs[today]?.punctual) return undefined;
  if (t && toMin(nowHHMM) >= toMin(t.start)) return today;
  for (let i = 1; i <= 3; i += 1) {
    const d = addDays(today, -i);
    if (!workDayOf(work, d)) continue;
    return logs[d]?.punctual ? undefined : d;
  }
  return undefined;
}

export function pruneLogs(logs: Record<string, WakeLog>, today: string, keep = 120): Record<string, WakeLog> {
  const min = addDays(today, -keep);
  return Object.fromEntries(Object.entries(logs).filter(([d]) => d >= min));
}

const LINES_EARLY = [
  'Stark – der frühe Start gehört dir.',
  'Pünktlich raus aus den Federn. So fängt ein guter Tag an.',
  'Genau so baut man eine Gewohnheit: Tag für Tag.',
  'Du hast den Wecker besiegt. Weiter so!',
];
const LINES_LATE = [
  'Nicht schlimm – morgen ist die nächste Chance. Leg dein Handy heute Abend früher weg.',
  'Ein Ausrutscher ist kein Muster. Morgen zählt wieder.',
  'Tipp: Wecker außer Reichweite stellen und direkt Licht an.',
];

/** Short motivating line after the quiz (deterministic per date). */
export function motivation(early: boolean, streak: number, date: string): string {
  if (early && streak >= 3) return `${streak} Tage in Folge früh auf – ${streak >= 7 ? 'eine ganze Woche, richtig stark!' : 'du bist auf Kurs.'}`;
  const list = early ? LINES_EARLY : LINES_LATE;
  const seed = Number(date.replace(/-/g, '')) % list.length;
  return list[seed];
}

export function punctualityLabel(p: Punctuality): string {
  return p === 'ja' ? 'Pünktlich' : p === 'knapp' ? 'Knapp' : 'Zu spät';
}

/** Compact lines for Nova Chat. */
export function wakeContextLines(config: MorningConfig, logs: Record<string, WakeLog>, today: string): string[] {
  const lines: string[] = [];
  const s = wakeStats(logs, config.work, today);
  const plan = wakePlanInfo(config, today);
  const log = logs[today];
  const target = targetWakeFor(config, today);
  lines.push(
    `Aufstehen: Ziel heute ${target}${plan && plan.goal !== target ? ` (Endziel ${plan.goal}, ${plan.stepsLeft} Schritte à ${config.wakeGoal!.stepMinutes} Min.)` : ''}; ${
      log?.wokeAt ? `heute um ${log.wokeAt} aufgestanden (${log.early ? 'pünktlich' : `${wakeDelta(log.wokeAt, target)} Min. zu spät`})` : 'heute noch kein Wach-Quiz'
    }; letzte 14 Tage ${s.early.hit}/${s.early.of} pünktlich auf, Serie ${s.wakeStreak} Tage.${log?.focus ? ` Fokus heute: ${log.focus}.` : ''}`,
  );
  if (config.work) {
    const w = workDayOf(config.work, today);
    lines.push(
      `Arbeit: ${w ? `heute Beginn ${w.start}, ${w.travel} Min. Weg${w.buffer ? ` + ${w.buffer} Min. Puffer` : ''}, losgehen ${leaveTimeFor(config.work, today)}` : 'heute kein Arbeitstag'}; pünktlich ${s.punctual.hit}/${s.punctual.of} Arbeitstage (14 Tage), Serie ${s.punctualStreak}.`,
    );
  }
  return lines;
}
