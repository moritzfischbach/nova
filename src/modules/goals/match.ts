import type { Goal } from '../../types';

export const SAVINGS_WORDS = ['sparen', 'spare', 'gespart', 'sparziel', 'zurücklegen', 'zurückgelegt', 'zuruecklegen', 'rücklage', 'ruecklage'];

function norm(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** True if the text is a savings entry ("Sparen Urlaub", "für Urlaub zurücklegen"). */
export function isSavingsText(text: string): boolean {
  const words = norm(text).split(' ');
  return words.some((w) => SAVINGS_WORDS.includes(w));
}

/**
 * Finds the savings goal a finance entry belongs to, e.g. "Sparen Urlaub" → goal "Urlaub Portugal".
 * Matches goal title words and keywords; longest match wins. Only open savings goals.
 */
export function matchSavingsGoal(text: string, goals: Goal[]): Goal | undefined {
  const words = norm(text).split(' ').filter((w) => w && !SAVINGS_WORDS.includes(w) && !['für', 'fuer', 'aufs', 'auf', 'das', 'den', 'die', 'ins', 'in', 'zum', 'zur'].includes(w));
  if (words.length === 0) return undefined;
  let best: { goal: Goal; score: number } | undefined;
  for (const goal of goals) {
    if (goal.kind !== 'spar' || goal.status !== 'offen') continue;
    const candidates = [...norm(goal.title).split(' '), ...(goal.keywords ?? []).map(norm)].filter((w) => w.length >= 3);
    let score = 0;
    for (const w of words) {
      for (const c of candidates) {
        if (c === w) score = Math.max(score, c.length + 10);
        else if (w.length >= 4 && (c.startsWith(w) || w.startsWith(c))) score = Math.max(score, Math.min(c.length, w.length));
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { goal, score };
  }
  return best?.goal;
}

export function savedAmount(goal: Goal): number {
  return Math.round(goal.deposits.reduce((sum, d) => sum + d.amount, 0) * 100) / 100;
}

export function goalProgress(goal: Goal): number {
  if (goal.kind !== 'spar' || !goal.targetAmount) return goal.status === 'erreicht' ? 1 : 0;
  return Math.max(0, Math.min(1, savedAmount(goal) / goal.targetAmount));
}

/** Suggested monthly rate to reach the target by the deadline. */
export function monthlyRate(goal: Goal, today: string): number | undefined {
  if (goal.kind !== 'spar' || !goal.targetAmount || !goal.targetDate) return undefined;
  const rest = goal.targetAmount - savedAmount(goal);
  if (rest <= 0) return 0;
  const [y1, m1] = today.split('-').map(Number);
  const [y2, m2] = goal.targetDate.split('-').map(Number);
  const months = Math.max(1, (y2 - y1) * 12 + (m2 - m1));
  return Math.ceil((rest / months) * 100) / 100;
}
