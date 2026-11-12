import { getAll, getById, putRecord, removeRecord, STORES } from '../../data/db';
import { createId } from '../../shared/id';
import type { Goal, GoalDeposit } from '../../types';
import { goalProgress } from './match';

export const GOAL_COLORS = ['#C9A36A', '#7C4A6A', '#3D7A9A', '#5B8A4A', '#B85C8A', '#D08A2A'];

export async function listGoals(): Promise<Goal[]> {
  const goals = await getAll<Goal>(STORES.goals);
  return goals.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'offen' ? -1 : 1;
    return (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.title.localeCompare(b.title, 'de');
  });
}

export async function getGoal(id: string): Promise<Goal | undefined> {
  return getById<Goal>(STORES.goals, id);
}

export async function saveGoal(input: Partial<Goal> & Pick<Goal, 'kind' | 'title'>): Promise<Goal> {
  const now = new Date().toISOString();
  const existing = input.id ? await getGoal(input.id) : undefined;
  const goal: Goal = {
    id: input.id ?? createId(),
    kind: input.kind,
    title: input.title.trim(),
    targetDate: input.targetDate || undefined,
    note: input.note?.trim() || undefined,
    status: input.status ?? existing?.status ?? 'offen',
    targetAmount: input.kind === 'spar' ? input.targetAmount ?? existing?.targetAmount : undefined,
    deposits: input.deposits ?? existing?.deposits ?? [],
    keywords: input.keywords ?? existing?.keywords ?? [],
    color: input.color ?? existing?.color ?? GOAL_COLORS[Math.floor(Math.random() * GOAL_COLORS.length)],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return putRecord(STORES.goals, goal);
}

export async function deleteGoal(id: string): Promise<void> {
  await removeRecord(STORES.goals, id);
}

export async function addDeposit(goalId: string, deposit: Omit<GoalDeposit, 'id'>): Promise<Goal | undefined> {
  const goal = await getGoal(goalId);
  if (!goal) return undefined;
  const next: Goal = { ...goal, deposits: [...goal.deposits, { id: createId(), ...deposit }], updatedAt: new Date().toISOString() };
  if (next.kind === 'spar' && next.targetAmount && goalProgress(next) >= 1) next.status = 'erreicht';
  return putRecord(STORES.goals, next);
}

export async function removeDeposit(goalId: string, depositId: string): Promise<Goal | undefined> {
  const goal = await getGoal(goalId);
  if (!goal) return undefined;
  return putRecord(STORES.goals, { ...goal, deposits: goal.deposits.filter((d) => d.id !== depositId), updatedAt: new Date().toISOString() });
}

export async function removeDepositByTransaction(txId: string): Promise<void> {
  for (const goal of await listGoals()) {
    if (goal.deposits.some((d) => d.txId === txId)) {
      await putRecord(STORES.goals, { ...goal, deposits: goal.deposits.filter((d) => d.txId !== txId) });
    }
  }
}
