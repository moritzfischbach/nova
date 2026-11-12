/** Pure Morgenplaner logic (unit-tested). */
import { addDays, parseLocalDate } from '../../shared/dates';
import type { Habit, MorningConfig, RoutineItem, TodoItem } from '../../types';
import { normalizeWakeGoal, normalizeWork } from './wake';
import { frequencyLabel, isDone, isDueOn } from '../habits/logic';

export const DEFAULT_ROUTINE: RoutineItem[] = [
  { id: 'r-wasser', title: 'Ein Glas Wasser trinken', time: '07:00' },
  { id: 'r-bewegen', title: '5 Minuten dehnen', time: '07:05' },
  { id: 'r-bad', title: 'Duschen & anziehen', time: '07:15' },
  { id: 'r-fruehstueck', title: 'Frühstück', time: '07:30' },
  { id: 'r-plan', title: 'Tag planen', time: '07:45' },
];

export const DEFAULT_MORNING: MorningConfig = { wakeTime: '07:00', remind: false, routine: DEFAULT_ROUTINE, checks: {} };

export function normalizeConfig(raw: Partial<MorningConfig> | undefined): MorningConfig {
  const c = raw ?? {};
  const time = (t: unknown) => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? t : undefined);
  return {
    wakeTime: time(c.wakeTime) ?? DEFAULT_MORNING.wakeTime,
    remind: c.remind === true,
    routine: Array.isArray(c.routine) ? c.routine.filter((r) => r && typeof r.title === 'string' && r.title.trim()).map((r) => ({ id: String(r.id), title: r.title.trim().slice(0, 80), time: time(r.time) })) : DEFAULT_ROUTINE,
    checks: c.checks && typeof c.checks === 'object' ? c.checks : {},
    budget: typeof c.budget === 'number' && c.budget > 0 ? c.budget : undefined,
    wakeGoal: normalizeWakeGoal(c.wakeGoal),
    work: normalizeWork(c.work),
    linkHabits: c.linkHabits === true ? true : undefined,
    dailyQuiz: c.dailyQuiz === true ? true : undefined,
    wakeByDay: c.wakeByDay && typeof c.wakeByDay === 'object' ? Object.fromEntries(Object.entries(c.wakeByDay).filter(([k, v]) => /^[1-7]$/.test(k) && time(v))) : undefined,
  };
}

export function sortRoutine(items: RoutineItem[]): RoutineItem[] {
  return [...items].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
}

/** Keeps only the last `keep` days of checks. */
export function pruneChecks(checks: Record<string, string[]>, today: string, keep = 14): Record<string, string[]> {
  const min = addDays(today, -keep + 1);
  return Object.fromEntries(Object.entries(checks).filter(([d, ids]) => d >= min && d <= today && ids.length));
}

export function toggleRoutineCheck(config: MorningConfig, date: string, id: string): MorningConfig {
  const set = new Set(config.checks[date] ?? []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return { ...config, checks: pruneChecks({ ...config.checks, [date]: [...set] }, date) };
}

export function routineProgress(config: MorningConfig, date: string): { done: number; total: number } {
  const ids = new Set(config.routine.map((r) => r.id));
  return { done: (config.checks[date] ?? []).filter((id) => ids.has(id)).length, total: config.routine.length };
}

/** Open todos due today or earlier, overdue first. */
export function dueTodos(todos: TodoItem[], today: string): TodoItem[] {
  return todos
    .filter((t) => !t.done && t.dueDate && t.dueDate <= today)
    .sort((a, b) => `${a.dueDate}${a.dueTime ?? '99'}`.localeCompare(`${b.dueDate}${b.dueTime ?? '99'}`));
}

export function habitsToday(habits: Habit[], today: string): Habit[] {
  return habits.filter((h) => !h.archived && isDueOn(h, today));
}

export interface BudgetStatus {
  budget: number;
  spent: number;
  left: number;
  daysLeft: number;
  perDay: number;
  ratio: number;
  over: boolean;
  /** spent faster than the month progressed */
  ahead: boolean;
}

export function budgetStatus(budget: number, spent: number, today: string): BudgetStatus {
  const d = parseLocalDate(today);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - d.getDate() + 1;
  const left = Math.round((budget - spent) * 100) / 100;
  return {
    budget,
    spent,
    left,
    daysLeft,
    perDay: left > 0 ? Math.floor((left / daysLeft) * 100) / 100 : 0,
    ratio: budget ? spent / budget : 0,
    over: spent > budget,
    ahead: spent / budget > d.getDate() / daysInMonth + 0.05,
  };
}

export interface PlanInput {
  date: string;
  weekday: string;
  wakeTime: string;
  events: { title: string; start?: string; end?: string; allDay: boolean; location?: string }[];
  todos: TodoItem[];
  habits: Habit[];
  routine: RoutineItem[];
  /** current time HH:MM (plan only from now on when later than the wake time) */
  now?: string;
}

/** The message sent to Nova Chat for "Tag planen mit Nova". */
export function buildPlanPrompt(p: PlanInput): string {
  const lines: string[] = [];
  const late = p.now && p.now > p.wakeTime;
  lines.push(
    late
      ? `Plane bitte meinen Tag (${p.weekday}, ${p.date}) in Zeitblöcken – es ist schon ${p.now} Uhr, also bitte erst ab jetzt planen.`
      : `Plane bitte meinen Tag (${p.weekday}, ${p.date}) in Zeitblöcken. Ich stehe um ${p.wakeTime} Uhr auf.`,
  );
  if (p.routine.length && !late) lines.push(`Morgenroutine: ${sortRoutine(p.routine).map((r) => `${r.time ? `${r.time} ` : ''}${r.title}`).join('; ')}.`);
  lines.push(
    p.events.length
      ? `Feste Termine: ${p.events.map((e) => `${e.allDay ? 'ganztägig' : `${e.start ?? ''}${e.end ? `–${e.end}` : ''}`} ${e.title}${e.location ? ` (${e.location})` : ''}`).join('; ')}.`
      : 'Heute habe ich keine festen Termine.',
  );
  if (p.todos.length) lines.push(`Fällige Aufgaben: ${p.todos.slice(0, 10).map((t) => `${t.title}${t.dueDate && t.dueDate < p.date ? ' (überfällig)' : t.dueTime ? ` (bis ${t.dueTime})` : ''}`).join('; ')}.`);
  const open = p.habits.filter((h) => !isDone(h, p.date));
  if (open.length) lines.push(`Gewohnheiten für heute: ${open.map((h) => `${h.name} (${frequencyLabel(h.frequency)}${h.reminderTime ? `, gern um ${h.reminderTime}` : ''})`).join('; ')}.`);
  lines.push('Schlag mir einen realistischen Plan mit Pausen vor und lege die Blöcke für Aufgaben und Gewohnheiten als Termine an (termin_anlegen, heutiges Datum, Beginn/Ende) – ich bestätige jeden einzeln. Feste Termine nicht doppelt anlegen.');
  return lines.join('\n');
}
