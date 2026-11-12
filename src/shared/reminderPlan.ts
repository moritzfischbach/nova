/**
 * Pure reminder planning (unit-tested). Turns local events, todos and goals into
 * absolute reminder instants; the server only stores and fires them.
 */
import { addDays, parseLocalDate } from './dates';
import { expandAll } from '../modules/calendar/recurrence';
import type { CalendarEvent, Goal, Habit, MorningConfig, TodoItem, WakeLog } from '../types';
import { fromMin, leaveTimeFor, targetWakeFor, toMin, workDayOf } from '../modules/morning/wake';
import { isDone, isScheduled, weekCount } from '../modules/habits/logic';

export interface PlannedReminder {
  id: string;
  at: string; // ISO instant
  title: string;
  body?: string;
  url?: string;
}

function localInstant(date: string, time = '09:00'): Date {
  const d = parseLocalDate(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function lead(minutes: number): string {
  if (minutes === 0) return 'jetzt';
  if (minutes < 60) return `in ${minutes} Minuten`;
  if (minutes < 1440) return minutes === 60 ? 'in 1 Stunde' : `in ${Math.round(minutes / 60)} Stunden`;
  return minutes === 1440 ? 'morgen' : `in ${Math.round(minutes / 1440)} Tagen`;
}

export function planReminders(
  input: { events: CalendarEvent[]; todos: TodoItem[]; goals: Goal[]; habits?: Habit[]; morning?: MorningConfig; wakeLogs?: Record<string, WakeLog> },
  now: Date = new Date(),
  horizonDays = 30,
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const nowMs = now.getTime();
  const horizon = nowMs + horizonDays * 86_400_000;
  const y = now.getFullYear();
  const today = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const push = (r: Omit<PlannedReminder, 'at'>, at: Date) => {
    const t = at.getTime();
    if (t > nowMs - 60_000 && t <= horizon) out.push({ ...r, at: at.toISOString() });
  };

  for (const inst of expandAll(input.events.filter((e) => e.reminderMinutes !== undefined && e.reminderMinutes !== null), today, addDays(today, horizonDays + 1))) {
    const e = inst.event;
    const minutes = e.reminderMinutes ?? 0;
    const start = e.allDay ? localInstant(inst.date, '09:00') : localInstant(inst.date, e.startTime ?? '09:00');
    const at = new Date(start.getTime() - minutes * 60_000);
    push(
      {
        id: `event:${e.id}:${inst.date}`,
        title: e.title,
        body: e.allDay ? `Ganztägig · ${minutes >= 1440 ? 'morgen' : 'heute'}` : `${e.startTime ?? ''} Uhr · ${lead(minutes)}${e.location ? ` · ${e.location}` : ''}`,
        url: '#/kalender',
      },
      at,
    );
  }

  for (const t of input.todos) {
    if (!t.remind || t.done || !t.dueDate) continue;
    push(
      { id: `todo:${t.id}`, title: `Aufgabe fällig: ${t.title}`, body: t.dueTime ? `Heute um ${t.dueTime} Uhr` : 'Heute fällig', url: '#/aufgaben' },
      localInstant(t.dueDate, t.dueTime ?? '09:00'),
    );
  }

  for (const g of input.goals) {
    if (g.status !== 'offen' || !g.targetDate) continue;
    push(
      { id: `goal:${g.id}:1d`, title: `Ziel morgen fällig: ${g.title}`, body: g.kind === 'spar' ? 'Sparziel – schau, wie weit du bist.' : 'Morgen ist dein Zieldatum.', url: `#/ziele?id=${g.id}` },
      localInstant(addDays(g.targetDate, -1), '09:00'),
    );
    push(
      { id: `goal:${g.id}:0d`, title: `Heute ist Zieldatum: ${g.title}`, body: 'Erreicht? Dann hak es in Nova ab.', url: `#/ziele?id=${g.id}` },
      localInstant(g.targetDate, '09:00'),
    );
  }

  // Daily things (wake-up brief, habit reminders) only for the next two weeks to keep the set small.
  const dailyDays = Math.min(horizonDays, 14);
  for (let i = 0; i <= dailyDays; i += 1) {
    const date = addDays(today, i);
    const m = input.morning;
    if (m?.remind && !input.wakeLogs?.[date]?.quizAt) {
      push({ id: `morning:${date}`, title: 'Guten Morgen ☀️', body: 'Zeit fürs Wach-Quiz – 3 kurze Fragen, dann steht dein Tag.', url: '#/morgen?quiz=1' }, localInstant(date, targetWakeFor(m, date)));
    }
    const work = workDayOf(m?.work, date);
    if (m?.work && work) {
      const leave = leaveTimeFor(m.work, date)!;
      if (m.work.leaveRemind) {
        const lead = m.work.leaveLead;
        push(
          { id: `leave:${date}`, title: 'Zeit loszugehen 🚶', body: `${lead ? `In ${lead} Min. losgehen (${leave} Uhr)` : `Jetzt losgehen (${leave} Uhr)`} – Arbeitsbeginn ${work.start} Uhr, ${work.travel} Min. Weg.`, url: '#/morgen' },
          localInstant(date, fromMin(toMin(leave) - lead)),
        );
      }
      if (m.work.checkinTime && !input.wakeLogs?.[date]?.punctual) {
        push({ id: `checkin:${date}`, title: 'Warst du heute pünktlich?', body: 'Ein Tipp genügt: Ja, knapp oder zu spät.', url: `#/morgen?checkin=${date}` }, localInstant(date, m.work.checkinTime));
      }
    }
    for (const h of input.habits ?? []) {
      if (h.archived || !h.reminderTime || isDone(h, date)) continue;
      if (h.frequency.type === 'perWeek' ? weekCount(h, date) >= h.frequency.times : !isScheduled(h.frequency, date)) continue;
      push({ id: `habit:${h.id}:${date}`, title: `${h.emoji} ${h.name}`, body: 'Zeit für deine Gewohnheit. Abhaken in Nova.', url: `#/gewohnheiten?id=${h.id}` }, localInstant(date, h.reminderTime));
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 500);
}
