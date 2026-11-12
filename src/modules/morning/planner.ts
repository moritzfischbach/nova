/** Morgenplan-Quiz: deterministic "perfect morning" planner (pure, unit-tested). */
import type { MorningConfig, RoutineItem, WakeGoal, WorkConfig, WorkDay } from '../../types';
import { fromMin, toMin } from './wake';

export interface ActivityDef {
  id: string;
  title: string;
  emoji: string;
  minutes: number;
  /** sort rank: water/movement first, then bathroom, breakfast, teeth, packing */
  rank: number;
  must?: boolean;
  preselect?: boolean;
}

export const ACTIVITIES: ActivityDef[] = [
  { id: 'meditieren', title: 'Meditieren', emoji: '🧘', minutes: 10, rank: 20 },
  { id: 'dehnen', title: 'Dehnen / Yoga', emoji: '🤸', minutes: 10, rank: 25 },
  { id: 'sport', title: 'Sport / Workout', emoji: '🏃', minutes: 30, rank: 30 },
  { id: 'duschen', title: 'Duschen', emoji: '🚿', minutes: 15, rank: 40, must: true, preselect: true },
  { id: 'anziehen', title: 'Anziehen', emoji: '👕', minutes: 10, rank: 45, must: true, preselect: true },
  { id: 'kaffee', title: 'Kaffee', emoji: '☕', minutes: 5, rank: 50, preselect: true },
  { id: 'fruehstueck', title: 'Frühstück', emoji: '🥣', minutes: 20, rank: 55, must: true, preselect: true },
  { id: 'lesen', title: 'Lesen', emoji: '📖', minutes: 15, rank: 60 },
  { id: 'planen', title: 'Tag planen', emoji: '🗓️', minutes: 5, rank: 65 },
  { id: 'haushalt', title: 'Haushalt kurz', emoji: '🧺', minutes: 10, rank: 70 },
  { id: 'tiere', title: 'Tiere / Kinder', emoji: '🐾', minutes: 20, rank: 75 },
  { id: 'zaehne', title: 'Zähne putzen', emoji: '🪥', minutes: 5, rank: 80, must: true, preselect: true },
  { id: 'packen', title: 'Tasche packen', emoji: '🎒', minutes: 5, rank: 90, must: true, preselect: true },
];
const CUSTOM_RANK = 68;
const ME_TIME_RANK = 85;

export type WakeType = 'schnell' | 'normal' | 'langsam';
export const WAKE_TYPES: Record<WakeType, { label: string; hint: string; minutes: number }> = {
  schnell: { label: 'Schnell wach', hint: 'Wecker klingelt, ich stehe auf', minutes: 5 },
  normal: { label: 'Ganz normal', hint: 'Ein paar Minuten zum Ankommen', minutes: 10 },
  langsam: { label: 'Brauche Zeit', hint: 'Snooze-Typ, langsam in den Tag', minutes: 20 },
};

export interface PlanActivity {
  id: string;
  title: string;
  emoji: string;
  minutes: number;
  must: boolean;
  custom?: boolean;
}

export interface PlanAnswers {
  /** ISO weekdays with work */
  days: number[];
  /** same start every work day */
  sameStart: boolean;
  arrive: string;
  /** per weekday arrival when !sameStart */
  arriveByDay: Record<string, string>;
  /** 'dauer': travel minutes known; 'abfahrt': departure time known (travel derived) */
  travelMode: 'dauer' | 'abfahrt';
  travel: number;
  departure: string;
  buffer: number;
  sleepHours: number;
  bedtime: string;
  wakeType: WakeType;
  activities: PlanActivity[];
  meTime: number;
}

export function defaultAnswers(): PlanAnswers {
  return {
    days: [1, 2, 3, 4, 5],
    sameStart: true,
    arrive: '08:30',
    arriveByDay: {},
    travelMode: 'dauer',
    travel: 25,
    departure: '07:50',
    buffer: 10,
    sleepHours: 7.5,
    bedtime: '23:00',
    wakeType: 'normal',
    activities: ACTIVITIES.filter((a) => a.preselect).map((a) => ({ id: a.id, title: a.title, emoji: a.emoji, minutes: a.minutes, must: Boolean(a.must) })),
    meTime: 10,
  };
}

export function arriveFor(a: PlanAnswers, day: number): string {
  return (!a.sameStart && a.arriveByDay[String(day)]) || a.arrive;
}

/** Travel minutes (derived from the departure time when that is what the user knows). */
export function travelMinutes(a: PlanAnswers): number {
  if (a.travelMode === 'dauer') return Math.max(0, Math.round(a.travel));
  const reference = a.days[0] ?? 1;
  const t = toMin(arriveFor(a, reference)) - a.buffer - toMin(a.departure);
  return Math.max(0, t);
}

export interface Step {
  id: string;
  title: string;
  emoji: string;
  start: string;
  minutes: number;
  must: boolean;
}

export interface MorningPlan {
  wake: string;
  leave: string;
  arrival: string;
  workStart: string;
  travel: number;
  buffer: number;
  steps: Step[];
  totalMinutes: number;
  bedtime: string;
  /** natural wake time from the usual bedtime + sleep goal */
  naturalWake: string;
  hints: string[];
  packed: boolean;
  /** wake time without nice-to-haves (only when packed) */
  compactWake?: string;
  dropped: string[];
  perDay: { day: number; arrive: string; leave: string; wake: string }[];
  referenceDay: number;
}

const rankOf = (p: PlanActivity) => (p.id === 'metime' ? ME_TIME_RANK : ACTIVITIES.find((a) => a.id === p.id)?.rank ?? CUSTOM_RANK);
const fmtH = (h: number) => `${String(h).replace('.', ',')} Std.`;

export function orderActivities(list: PlanActivity[]): PlanActivity[] {
  return [...list].sort((a, b) => rankOf(a) - rankOf(b) || a.title.localeCompare(b.title));
}

/** Morning steps in order, including the wake-up phase and optional me-time. */
export function stepsFor(a: PlanAnswers, compact = false): PlanActivity[] {
  const chosen = a.activities.filter((x) => x.minutes > 0 && (!compact || x.must));
  const wake: PlanActivity = { id: 'aufwachen', title: 'Aufwachen & ein Glas Wasser', emoji: '💧', minutes: WAKE_TYPES[a.wakeType].minutes, must: true };
  const me: PlanActivity[] = a.meTime > 0 && !compact ? [{ id: 'metime', title: 'Puffer / Zeit für dich', emoji: '✨', minutes: a.meTime, must: false }] : [];
  return [wake, ...orderActivities([...chosen, ...me])];
}

const roundDown5 = (m: number) => Math.floor(m / 5) * 5;

export function computePlan(a: PlanAnswers, opts: { compact?: boolean } = {}): MorningPlan {
  const days = [...a.days].sort();
  const referenceDay = days[0] ?? 1;
  const travel = travelMinutes(a);
  const workStart = arriveFor(a, referenceDay);
  const leaveMin = toMin(workStart) - travel - a.buffer;
  const list = stepsFor(a, opts.compact);
  const total = list.reduce((s, x) => s + x.minutes, 0);
  // wake on a 5-minute grid so the alarm is easy to set; extra minutes go to the first step
  const wakeMin = roundDown5(leaveMin - total);
  const steps: Step[] = [];
  let t = wakeMin;
  list.forEach((x, i) => {
    const minutes = i === 0 ? x.minutes + (leaveMin - total - wakeMin) : x.minutes;
    steps.push({ id: x.id, title: x.title, emoji: x.emoji, start: fromMin(t), minutes, must: x.must });
    t += minutes;
  });
  const sleep = Math.round(a.sleepHours * 60);
  const bedtime = fromMin(roundDown5(wakeMin - sleep));
  const naturalWakeMin = toMin(a.bedtime) + sleep;
  const naturalWake = fromMin(naturalWakeMin);
  const hints: string[] = [];
  const lateBy = ((naturalWakeMin - wakeMin) % 1440 + 1440) % 1440;
  const sleepShort = lateBy > 0 && lateBy < 720;
  if (sleepShort && lateBy >= 15) {
    hints.push(`Du gehst meist um ${a.bedtime} ins Bett – für ${fmtH(a.sleepHours)} Schlaf solltest du um ${bedtime} schlafen. Nova verschiebt deine Aufstehzeit schrittweise, damit es leichter fällt.`);
  }
  const optional = a.activities.filter((x) => !x.must).reduce((s, x) => s + x.minutes, 0) + (a.meTime > 0 ? a.meTime : 0);
  const packed = !opts.compact && optional > 0 && (total > 120 || (sleepShort && lateBy > 45) || wakeMin < 4 * 60 + 30);
  let compactWake: string | undefined;
  const dropped: string[] = [];
  if (packed) {
    const c = computePlan(a, { compact: true });
    compactWake = c.wake;
    dropped.push(...a.activities.filter((x) => !x.must).map((x) => x.title), ...(a.meTime > 0 ? ['Puffer / Zeit für dich'] : []));
    hints.push(`Dein Morgen ist ziemlich voll (${total} Min.). Ohne die Kann-Sachen (${dropped.join(', ')}) könntest du erst um ${compactWake} aufstehen.`);
  }
  if (wakeMin < 4 * 60 + 30) hints.push('Aufstehen vor 4:30 ist kaum durchzuhalten – kürze ein paar Punkte oder plane Sport abends.');
  if (!list.some((x) => x.id === 'fruehstueck' || x.id === 'kaffee')) hints.push('Kein Frühstück geplant – ein Glas Wasser und eine Kleinigkeit helfen gegen das Vormittagstief.');
  const perDay = days.map((day) => {
    const arrive = arriveFor(a, day);
    const lm = toMin(arrive) - travel - a.buffer;
    return { day, arrive, leave: fromMin(lm), wake: fromMin(roundDown5(lm - total)) };
  });
  return {
    wake: fromMin(wakeMin),
    leave: fromMin(leaveMin),
    arrival: fromMin(leaveMin + travel),
    workStart,
    travel,
    buffer: a.buffer,
    steps,
    totalMinutes: total,
    bedtime,
    naturalWake,
    hints,
    packed,
    compactWake,
    dropped,
    perDay,
    referenceDay,
  };
}

/** Everything „Plan übernehmen“ changes in the Morgenplaner config. */
export function applyPlan(config: MorningConfig, plan: MorningPlan, today: string): MorningConfig {
  const routine: RoutineItem[] = plan.steps.map((s) => ({ id: `plan-${s.id}`, title: `${s.emoji} ${s.title}`, time: s.start }));
  const days: Record<string, WorkDay> = {};
  for (const d of plan.perDay) days[String(d.day)] = plan.buffer ? { start: d.arrive, travel: plan.travel, buffer: plan.buffer } : { start: d.arrive, travel: plan.travel };
  const work: WorkConfig = { days, leaveRemind: true, leaveLead: config.work?.leaveLead ?? 5, checkinTime: config.work?.checkinTime ?? '18:30' };
  // natural wake (bedtime + sleep) much later than the plan → gradual, 10 min per week
  const late = toMin(plan.naturalWake) - toMin(plan.wake);
  const gradual = late >= 20 && late < 180;
  const wakeGoal: WakeGoal = gradual
    ? { goal: plan.wake, gradual: true, start: fromMin(Math.ceil((toMin(plan.wake) + Math.min(late, 60)) / 5) * 5), startDate: today, stepMinutes: 10, everyDays: 7 }
    : { goal: plan.wake, gradual: false, start: plan.wake, startDate: today, stepMinutes: 10, everyDays: 7 };
  const wakeByDay = plan.perDay.some((d) => d.wake !== plan.wake) ? Object.fromEntries(plan.perDay.map((d) => [String(d.day), d.wake])) : undefined;
  return { ...config, routine, wakeTime: gradual ? wakeGoal.start : plan.wake, remind: true, wakeGoal, work, wakeByDay, checks: {} };
}

/** Prompt for „Mit Nova verfeinern“. */
export function refinePrompt(a: PlanAnswers, plan: MorningPlan): string {
  const wd = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  return [
    'Ich habe in Nova meinen perfekten Morgen geplant. Bitte gib mir 3–5 persönliche, konkrete Tipps, wie ich ihn durchhalte (Abendroutine, Aufstehen, Zeitfresser). Lege nichts an, nur Tipps.',
    `Arbeit: ${a.days.map((d) => wd[d - 1]).join(', ')} ab ${plan.workStart}${a.sameStart ? '' : ' (an manchen Tagen anders)'}; ${plan.travel} Min. Weg + ${plan.buffer} Min. Puffer → losfahren ${plan.leave}.`,
    `Schlaf: Wunsch ${String(a.sleepHours).replace('.', ',')} Std., gehe meist um ${a.bedtime} ins Bett; empfohlen ins Bett um ${plan.bedtime}. Aufwach-Typ: ${WAKE_TYPES[a.wakeType].label}.`,
    `Plan: Aufstehen ${plan.wake}; ${plan.steps.map((s) => `${s.start} ${s.title} (${s.minutes} Min.${s.must ? '' : ', kann'})`).join('; ')}; losfahren ${plan.leave}.`,
    plan.hints.length ? `Hinweise: ${plan.hints.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
