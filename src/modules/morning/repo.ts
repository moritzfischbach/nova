import type { Habit, WakeLog } from '../../types';
import { todayISO } from '../../shared/dates';
import { LINKED_HABITS, pruneLogs } from './wake';
import { getMeta, setMeta } from '../../data/db';
import type { MorningConfig } from '../../types';
import { normalizeConfig } from './logic';

const KEY = 'morning.config';

export async function getMorningConfig(): Promise<MorningConfig> {
  return normalizeConfig(await getMeta<Partial<MorningConfig>>(KEY));
}

export async function saveMorningConfig(config: MorningConfig): Promise<MorningConfig> {
  const clean = normalizeConfig(config);
  await setMeta(KEY, clean);
  return clean;
}

// ---------- Aufstehen & Pünktlichkeit ----------

const LOG_KEY = 'wake.log';

export async function getWakeLogs(): Promise<Record<string, WakeLog>> {
  return (await getMeta<Record<string, WakeLog>>(LOG_KEY)) ?? {};
}

export async function saveWakeLog(date: string, patch: Partial<WakeLog>): Promise<WakeLog> {
  const logs = await getWakeLogs();
  const next: WakeLog = { ...(logs[date] ?? { date }), ...patch, date };
  await setMeta(LOG_KEY, pruneLogs({ ...logs, [date]: next }, todayISO()));
  return next;
}

/** Creates the two linked habits if needed (work habit only on configured work days). */
export async function ensureLinkedHabits(config: MorningConfig): Promise<void> {
  const { getHabit, saveHabit } = await import('../habits/repo');
  const wake = await getHabit(LINKED_HABITS.wake.id);
  if (!wake || wake.archived) await saveHabit({ id: LINKED_HABITS.wake.id, name: wake?.name ?? LINKED_HABITS.wake.name, emoji: LINKED_HABITS.wake.emoji, frequency: { type: 'daily' }, archived: false, completions: wake?.completions });
  const days = Object.keys(config.work?.days ?? {}).map(Number).sort();
  if (days.length) {
    const work = await getHabit(LINKED_HABITS.work.id);
    const frequency: Habit['frequency'] = days.length === 7 ? { type: 'daily' } : { type: 'weekdays', days };
    await saveHabit({ id: LINKED_HABITS.work.id, name: work?.name ?? LINKED_HABITS.work.name, emoji: LINKED_HABITS.work.emoji, frequency, archived: false, completions: work?.completions });
  }
}

export async function markLinkedHabit(which: 'wake' | 'work', date: string, done: boolean, config: MorningConfig): Promise<void> {
  if (!config.linkHabits) return;
  await ensureLinkedHabits(config);
  const { setHabitDone } = await import('../habits/repo');
  await setHabitDone(LINKED_HABITS[which].id, date, done);
}
