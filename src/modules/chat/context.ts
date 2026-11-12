/** Compact summary of local Nova data for the chat (kept well below the server's 3000-char limit). */
import { addDays, todayISO } from '../../shared/dates';
import { formatEUR } from '../../shared/money';
import type { Goal, Habit, TodoItem, TodoList } from '../../types';
import { frequencyLabel, isDone, isDueOn, streak } from '../habits/logic';
import type { EventInstance } from '../calendar/recurrence';
import { savedAmount } from '../goals/match';

export const CONTEXT_KEY = 'nova.chatContext';
export const CONTEXT_MAX = 2400;

export function contextSharingEnabled(): boolean {
  return localStorage.getItem(CONTEXT_KEY) !== 'off';
}
export function setContextSharing(on: boolean): void {
  localStorage.setItem(CONTEXT_KEY, on ? 'on' : 'off');
}

export interface ContextData {
  today: string;
  todos: TodoItem[];
  lists: TodoList[];
  instances: EventInstance[];
  month: { label: string; expenses: number; income: number; byCategory: { name: string; amount: number }[] };
  goals: Goal[];
  habits?: Habit[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function formatContext(d: ContextData): string {
  const lines: string[] = [];
  const listName = new Map(d.lists.map((l) => [l.id, l.name]));
  const open = d.todos.filter((t) => !t.done);
  lines.push(`Offene Aufgaben (${open.length}):`);
  open
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 12)
    .forEach((t) => lines.push(`- ${clip(t.title, 70)}${t.dueDate ? ` (fällig ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''})` : ''}${listName.get(t.listId) ? ` [${listName.get(t.listId)}]` : ''}`));
  if (open.length > 12) lines.push(`- … und ${open.length - 12} weitere`);

  const until = addDays(d.today, 7);
  const next = d.instances.filter((i) => i.date >= d.today && i.date <= until).slice(0, 12);
  lines.push(`Termine bis ${until} (${next.length}):`);
  next.forEach((i) => lines.push(`- ${i.date}${i.event.allDay ? ' ganztägig' : ` ${i.event.startTime ?? ''}${i.event.endTime ? `–${i.event.endTime}` : ''}`} ${clip(i.event.title, 60)}${i.event.location ? ` @ ${clip(i.event.location, 30)}` : ''}`));

  lines.push(`Finanzen ${d.month.label}: Ausgaben ${formatEUR(d.month.expenses)}, Einnahmen ${formatEUR(d.month.income)}`);
  d.month.byCategory.slice(0, 8).forEach((c) => lines.push(`- ${c.name}: ${formatEUR(c.amount)}`));

  const goals = d.goals.filter((g) => g.status === 'offen').slice(0, 8);
  lines.push(`Ziele (${goals.length} offen):`);
  goals.forEach((g) =>
    lines.push(
      g.kind === 'spar'
        ? `- Sparziel „${clip(g.title, 40)}“: ${formatEUR(savedAmount(g))} von ${formatEUR(g.targetAmount ?? 0)}${g.targetDate ? ` bis ${g.targetDate}` : ''}`
        : `- Ziel „${clip(g.title, 50)}“${g.targetDate ? ` bis ${g.targetDate}` : ''}`,
    ),
  );
  const habits = (d.habits ?? []).filter((h) => !h.archived).slice(0, 10);
  if (habits.length) {
    lines.push(`Gewohnheiten (${habits.length}):`);
    habits.forEach((h) => {
      const s = streak(h, d.today);
      lines.push(`- ${h.emoji} ${clip(h.name, 40)} (${frequencyLabel(h.frequency)}): heute ${isDone(h, d.today) ? 'erledigt' : isDueOn(h, d.today) ? 'offen' : 'frei'}${s.current ? `, Serie ${s.current} ${s.unit === 'Tag' ? 'Tage' : 'Wochen'}` : ''}`);
    });
  }
  let text = lines.join('\n');
  if (text.length > CONTEXT_MAX) text = `${text.slice(0, CONTEXT_MAX - 1)}…`;
  return text;
}

export async function buildContext(): Promise<string> {
  const [{ listTodos, listTodoLists }, { upcomingInstances }, { summarizeMonth, monthKey }, { listGoals }, { listHabits }] = await Promise.all([
    import('../todos/repo'),
    import('../calendar/repo'),
    import('../finance/repo'),
    import('../goals/repo'),
    import('../habits/repo'),
  ]);
  const today = todayISO();
  const [todos, lists, instances, month, goals, habits] = await Promise.all([listTodos(), listTodoLists(), upcomingInstances(today, 8, 20), summarizeMonth(monthKey(today)), listGoals(), listHabits()]);
  return formatContext({
    today,
    todos,
    lists,
    instances,
    month: {
      label: new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      expenses: month.expenses,
      income: month.income,
      byCategory: month.byCategory.map((c) => ({ name: c.category.name, amount: c.amount })),
    },
    goals,
    habits,
  });
}
