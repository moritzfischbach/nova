import { getAll, getById, putRecord, removeRecord, STORES } from '../../data/db';
import { createId } from '../../shared/id';
import { PALETTE } from '../../shared/palette';
import type { Habit } from '../../types';
import { toggleCompletion } from './logic';

export const HABIT_COLORS = [PALETTE.champagne, PALETTE.sage, PALETTE.sky, PALETTE.orchid, PALETTE.amber, PALETTE.lavender];
export const HABIT_EMOJIS = ['💧', '🏃', '🧘', '📖', '🥗', '😴', '🦷', '💊', '✍️', '🚶', '🏋️', '🧠', '🌿', '☀️', '🎯', '💰'];

export async function listHabits(includeArchived = false): Promise<Habit[]> {
  const all = await getAll<Habit>(STORES.habits);
  return all.filter((h) => includeArchived || !h.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getHabit(id: string): Promise<Habit | undefined> {
  return getById<Habit>(STORES.habits, id);
}

export async function saveHabit(input: Partial<Habit> & Pick<Habit, 'name' | 'frequency'>): Promise<Habit> {
  const now = new Date().toISOString();
  const existing = input.id ? await getHabit(input.id) : undefined;
  const count = existing ? 0 : (await listHabits(true)).length;
  const habit: Habit = {
    id: existing?.id ?? input.id ?? createId(),
    name: input.name.trim().slice(0, 60),
    emoji: (input.emoji ?? existing?.emoji ?? '✨').slice(0, 8) || '✨',
    frequency: input.frequency,
    reminderTime: input.reminderTime || undefined,
    color: input.color ?? existing?.color ?? HABIT_COLORS[count % HABIT_COLORS.length],
    completions: input.completions ?? existing?.completions ?? [],
    archived: input.archived ?? existing?.archived,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  return putRecord(STORES.habits, habit);
}

export async function toggleHabit(id: string, date: string): Promise<Habit | undefined> {
  const h = await getHabit(id);
  if (!h) return undefined;
  return putRecord(STORES.habits, { ...h, completions: toggleCompletion(h.completions, date), updatedAt: new Date().toISOString() });
}

export async function setHabitDone(id: string, date: string, done: boolean): Promise<Habit | undefined> {
  const h = await getHabit(id);
  if (!h) return undefined;
  if (h.completions.includes(date) === done) return h;
  return toggleHabit(id, date);
}

export function deleteHabit(id: string): Promise<void> {
  return removeRecord(STORES.habits, id);
}

/** Fuzzy lookup by name (chat tools): exact → startsWith → includes. */
export function findHabitByName(habits: Habit[], name: string): Habit | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  return (
    habits.find((h) => h.name.toLowerCase() === q) ??
    habits.find((h) => h.name.toLowerCase().startsWith(q) || q.startsWith(h.name.toLowerCase())) ??
    habits.find((h) => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase()))
  );
}
