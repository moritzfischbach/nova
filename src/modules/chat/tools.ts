/** Nova Chat tools: German labels for the confirmation chips and client-side execution. */
import { formatDateHuman, todayISO } from '../../shared/dates';
import { formatEUR } from '../../shared/money';
import type { BotModule, ChatToolCall, ChatToolName, HabitFrequency } from '../../types';
import { frequencyLabel, parseWeekdays } from '../habits/logic';

/** Frequency from chat-tool arguments (lenient). */
export function habitFrequencyFromArgs(a: Record<string, unknown>): HabitFrequency {
  const kind = typeof a.haeufigkeit === 'string' ? a.haeufigkeit.toLowerCase() : '';
  const days = parseWeekdays(a.wochentage);
  const times = Math.round(Number(a.mal_pro_woche));
  const perWeek = (): HabitFrequency => (times >= 1 && times <= 6 ? { type: 'perWeek', times } : { type: 'daily' });
  const weekdays = (): HabitFrequency => (days.length >= 1 && days.length <= 6 ? { type: 'weekdays', days } : { type: 'daily' });
  if (kind.startsWith('t')) return { type: 'daily' };
  if (kind.includes('pro')) return perWeek();
  if (kind.startsWith('wochentag')) return weekdays();
  if (days.length >= 1 && days.length <= 6) return weekdays();
  return perWeek();
}

export const TOOL_LABELS: Record<ChatToolName, string> = {
  aufgabe_anlegen: 'Aufgabe anlegen',
  termin_anlegen: 'Termin anlegen',
  finanzeintrag_erfassen: 'Finanzeintrag',
  sparziel_einzahlen: 'Sparziel-Einzahlung',
  an_grok_bot_weitergeben: 'An Grok Bot weitergeben',
  gewohnheit_anlegen: 'Gewohnheit anlegen',
  gewohnheit_abhaken: 'Gewohnheit abhaken',
};

type Args = Record<string, unknown>;

export function parseArgs(call: Pick<ChatToolCall, 'arguments'>): Args {
  try {
    const v = JSON.parse(call.arguments || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Args) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoDate = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const hhmm = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const m = v.match(/^(\d{1,2}):(\d{2})/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
};
const amount = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : undefined;
};
const plusHour = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(h + 1 > 23 ? 59 : m).padStart(2, '0')}`;
};

/** One-line German description of what the tool will do (shown in the chip before confirming). */
export function describeToolCall(call: Pick<ChatToolCall, 'name' | 'arguments'>): string {
  const a = parseArgs(call);
  switch (call.name) {
    case 'aufgabe_anlegen': {
      const due = isoDate(a.faellig_am);
      return `„${str(a.titel, 120) || 'Ohne Titel'}“${due ? ` · fällig ${formatDateHuman(due)}${hhmm(a.uhrzeit) ? ` ${hhmm(a.uhrzeit)}` : ''}` : ''}${str(a.liste) ? ` · Liste ${str(a.liste, 40)}` : ''}`;
    }
    case 'termin_anlegen': {
      const date = isoDate(a.datum);
      const start = hhmm(a.beginn);
      const allDay = a.ganztaegig === true || !start;
      return `„${str(a.titel, 120) || 'Termin'}“ · ${date ? formatDateHuman(date) : 'ohne Datum'}${allDay ? ' · ganztägig' : ` · ${start}${hhmm(a.ende) ? `–${hhmm(a.ende)}` : ''}`}${str(a.ort) ? ` · ${str(a.ort, 60)}` : ''}`;
    }
    case 'finanzeintrag_erfassen': {
      const n = amount(a.betrag);
      return `${a.art === 'einnahme' ? 'Einnahme' : 'Ausgabe'} ${n ? formatEUR(n) : '?'} · ${str(a.beschreibung, 80) || '—'}`;
    }
    case 'sparziel_einzahlen': {
      const n = amount(a.betrag);
      return `${n ? formatEUR(n) : '?'} → Sparziel „${str(a.ziel, 60) || '?'}“`;
    }
    case 'an_grok_bot_weitergeben':
      return `„${str(a.aufgabe, 160) || '—'}“`;
    case 'gewohnheit_anlegen':
      return `${str(a.emoji, 8) || '✨'} „${str(a.name, 60) || '?'}“ · ${frequencyLabel(habitFrequencyFromArgs(a))}${hhmm(a.erinnerung) ? ` · Erinnerung ${hhmm(a.erinnerung)}` : ''}`;
    case 'gewohnheit_abhaken': {
      const date = isoDate(a.datum);
      return `„${str(a.name, 60) || '?'}“ ${a.erledigt === false ? 'nicht erledigt' : 'erledigt'} · ${date && date !== todayISO() ? formatDateHuman(date) : 'heute'}`;
    }
    default:
      return 'Unbekannte Aktion';
  }
}

export interface ToolOutcome {
  ok: boolean;
  summary: string;
  link?: string;
  /** JSON string returned to the model */
  result: string;
}

const done = (summary: string, link: string | undefined, data: Record<string, unknown>): ToolOutcome => ({ ok: true, summary, link, result: JSON.stringify({ ok: true, ...data }) });
const failed = (summary: string): ToolOutcome => ({ ok: false, summary, result: JSON.stringify({ ok: false, fehler: summary }) });

export async function executeToolCall(call: Pick<ChatToolCall, 'name' | 'arguments'>): Promise<ToolOutcome> {
  const a = parseArgs(call);
  try {
    switch (call.name) {
      case 'aufgabe_anlegen': {
        const title = str(a.titel, 200);
        if (!title) return failed('Ohne Titel kann ich keine Aufgabe anlegen.');
        const { listTodoLists, createTodo, updateTodo } = await import('../todos/repo');
        const lists = await listTodoLists();
        const wanted = str(a.liste).toLowerCase();
        const list = (wanted && lists.find((l) => l.name.toLowerCase().includes(wanted))) || lists[0];
        if (!list) return failed('Es gibt keine Aufgabenliste.');
        const todo = await createTodo(list.id, title);
        const dueDate = isoDate(a.faellig_am);
        const dueTime = hhmm(a.uhrzeit);
        if (dueDate || dueTime) await updateTodo(todo.id, { dueDate: dueDate ?? todayISO(), dueTime, remind: a.erinnern === true || Boolean(dueTime) });
        return done(`Aufgabe „${title}“ angelegt (${list.name}).`, '#/aufgaben', { ergebnis: 'Aufgabe angelegt', titel: title, liste: list.name, faellig_am: dueDate });
      }
      case 'termin_anlegen': {
        const title = str(a.titel, 200);
        const date = isoDate(a.datum);
        if (!title || !date) return failed('Für einen Termin brauche ich Titel und Datum.');
        const start = hhmm(a.beginn);
        const allDay = a.ganztaegig === true || !start;
        const { saveEvent } = await import('../calendar/repo');
        const minutes = typeof a.erinnerung_minuten === 'number' && a.erinnerung_minuten >= 0 && a.erinnerung_minuten <= 40320 ? Math.round(a.erinnerung_minuten) : undefined;
        const ev = await saveEvent({
          title,
          date,
          allDay,
          startTime: allDay ? undefined : start,
          endTime: allDay ? undefined : hhmm(a.ende) ?? plusHour(start!),
          location: str(a.ort, 200) || undefined,
          notes: str(a.notiz, 1000) || undefined,
          reminderMinutes: minutes,
          calendarId: 'nova',
          exdates: [],
        });
        return done(`Termin „${title}“ am ${formatDateHuman(date)}${allDay ? '' : ` um ${start}`} eingetragen.`, `#/kalender`, { ergebnis: 'Termin angelegt', id: ev.id, datum: date, beginn: ev.startTime, ende: ev.endTime });
      }
      case 'finanzeintrag_erfassen': {
        const n = amount(a.betrag);
        const text = str(a.beschreibung, 120);
        if (!n || !text) return failed('Betrag oder Beschreibung fehlt.');
        const { createTransactionFromInput } = await import('../finance/repo');
        const raw = `${a.art === 'einnahme' ? '+' : ''}${String(n).replace('.', ',')} Euro ${text}`;
        const { tx, goal } = await createTransactionFromInput(raw, isoDate(a.datum) ?? todayISO());
        return done(`${tx.type === 'income' ? 'Einnahme' : 'Ausgabe'} ${formatEUR(tx.amount)} „${tx.note || text}“ erfasst${goal ? ` – Sparziel „${goal.title}“ gutgeschrieben` : ''}.`, '#/finanzen', { ergebnis: 'Eintrag erfasst', betrag: tx.amount, art: tx.type, sparziel: goal?.title });
      }
      case 'sparziel_einzahlen': {
        const n = amount(a.betrag);
        const name = str(a.ziel, 80);
        if (!n || !name) return failed('Ziel oder Betrag fehlt.');
        const { listGoals, addDeposit } = await import('../goals/repo');
        const { matchSavingsGoal, savedAmount } = await import('../goals/match');
        const goals = await listGoals();
        const goal = goals.find((g) => g.kind === 'spar' && g.title.toLowerCase() === name.toLowerCase()) ?? matchSavingsGoal(name, goals);
        if (!goal) return failed(`Kein offenes Sparziel „${name}“ gefunden.`);
        const next = await addDeposit(goal.id, { amount: n, date: todayISO(), note: 'über Nova Chat' });
        const saved = next ? savedAmount(next) : 0;
        return done(`${formatEUR(n)} auf „${goal.title}“ eingezahlt (jetzt ${formatEUR(saved)}${goal.targetAmount ? ` von ${formatEUR(goal.targetAmount)}` : ''}).`, `#/ziele?id=${goal.id}`, { ergebnis: 'Einzahlung gebucht', ziel: goal.title, gespart: saved, zielbetrag: goal.targetAmount });
      }
      case 'an_grok_bot_weitergeben': {
        const task = str(a.aufgabe, 2000);
        if (!task) return failed('Die Aufgabe für Grok Bot ist leer.');
        const { sendToGrokBot } = await import('../../shared/grokbot');
        const modules: BotModule[] = ['todos', 'kalender', 'finanzen', 'ziele', 'allgemein'];
        const module = modules.includes(a.bereich as BotModule) ? (a.bereich as BotModule) : 'allgemein';
        const rec = await sendToGrokBot({ task, module, context: str(a.kontext, 4000) || undefined });
        if (rec.status === 'gesendet') return done('An Grok Bot gesendet – die Antwort kommt in der Grok-App.', '#/grok', { ergebnis: 'An Grok Bot gesendet. Die Antwort erscheint in der Grok-App, nicht hier.' });
        if (rec.status === 'wartend') return done('Für Grok Bot gespeichert – wird gesendet, sobald Nova wieder online ist. Die Antwort kommt in der Grok-App.', '#/grok', { ergebnis: 'In der Warteschlange für Grok Bot' });
        return failed(rec.error ?? 'Grok Bot hat die Anfrage nicht angenommen.');
      }
      case 'gewohnheit_anlegen': {
        const name = str(a.name, 60);
        if (!name) return failed('Die Gewohnheit braucht einen Namen.');
        const { listHabits, saveHabit, findHabitByName } = await import('../habits/repo');
        const existing = findHabitByName(await listHabits(), name);
        if (existing && existing.name.toLowerCase() === name.toLowerCase()) return failed(`„${existing.name}“ gibt es schon.`);
        const frequency = habitFrequencyFromArgs(a);
        const emoji = str(a.emoji, 8) || '✨';
        const h = await saveHabit({ name, emoji, frequency, reminderTime: hhmm(a.erinnerung) });
        void import('../../shared/reminders').then((m) => m.syncReminders());
        return done(`${h.emoji} Gewohnheit „${h.name}“ angelegt (${frequencyLabel(frequency)}).`, `#/gewohnheiten?id=${h.id}`, { ergebnis: 'Gewohnheit angelegt', name: h.name, haeufigkeit: frequencyLabel(frequency) });
      }
      case 'gewohnheit_abhaken': {
        const name = str(a.name, 60);
        const { listHabits, setHabitDone, findHabitByName } = await import('../habits/repo');
        const { streak } = await import('../habits/logic');
        const habits = await listHabits();
        const h = findHabitByName(habits, name);
        if (!h) return failed(habits.length ? `Keine Gewohnheit „${name}“ gefunden. Vorhanden: ${habits.map((x) => x.name).join(', ')}.` : 'Es gibt noch keine Gewohnheiten.');
        const date = isoDate(a.datum) ?? todayISO();
        if (date > todayISO()) return failed('Zukünftige Tage kann ich nicht abhaken.');
        const doneFlag = a.erledigt !== false;
        const next = (await setHabitDone(h.id, date, doneFlag)) ?? h;
        const s = streak(next, todayISO());
        void import('../../shared/reminders').then((m) => m.syncReminders());
        return done(
          `${h.emoji} „${h.name}“ ${doneFlag ? 'abgehakt' : 'zurückgesetzt'}${date !== todayISO() ? ` (${formatDateHuman(date)})` : ''}${s.current ? ` – Serie: ${s.current} ${s.unit === 'Tag' ? (s.current === 1 ? 'Tag' : 'Tage') : s.current === 1 ? 'Woche' : 'Wochen'}` : ''}.`,
          `#/gewohnheiten?id=${h.id}`,
          { ergebnis: doneFlag ? 'Abgehakt' : 'Zurückgesetzt', name: h.name, datum: date, serie: s.current, einheit: s.unit },
        );
      }
      default:
        return failed('Unbekannte Aktion.');
    }
  } catch (err) {
    return failed(err instanceof Error ? err.message : 'Die Aktion ist fehlgeschlagen.');
  }
}
