import { describe, expect, it } from 'vitest';
import { goalProgress, isSavingsText, matchSavingsGoal, monthlyRate, savedAmount } from '../src/modules/goals/match';
import { parseExpenseInput } from '../src/modules/finance/parser';
import type { Goal } from '../src/types';

const goal = (o: Partial<Goal>): Goal => ({ id: 'g', kind: 'spar', title: 'Urlaub Portugal', status: 'offen', targetAmount: 1000, deposits: [], color: '#000', createdAt: '', updatedAt: '', ...o });

describe('Sparziel-Verknüpfung', () => {
  it('erkennt Spar-Einträge', () => {
    expect(isSavingsText('Sparen Urlaub')).toBe(true);
    expect(isSavingsText('für Auto zurücklegen')).toBe(true);
    expect(isSavingsText('Essen')).toBe(false);
  });
  it('"50 Euro Sparen Urlaub" → Sparziel Urlaub', () => {
    const parsed = parseExpenseInput('50 Euro Sparen Urlaub');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.amount).toBe(50);
    const goals = [goal({ id: 'auto', title: 'Neues Auto' }), goal({ id: 'urlaub' })];
    expect(matchSavingsGoal(parsed.text, goals)?.id).toBe('urlaub');
  });
  it('gesprochen: "fünfzig Euro sparen fürs Auto"', () => {
    const parsed = parseExpenseInput('fünfzig Euro sparen fürs Auto');
    expect(parsed.ok && parsed.amount).toBe(50);
    if (!parsed.ok) return;
    expect(matchSavingsGoal(parsed.text, [goal({ id: 'auto', title: 'Neues Auto' }), goal({ id: 'u' })])?.id).toBe('auto');
  });
  it('nutzt Stichwörter und ignoriert erreichte/allgemeine Ziele', () => {
    const goals = [goal({ id: 'a', title: 'Reise', keywords: ['portugal'], status: 'erreicht' }), goal({ id: 'b', title: 'Sommer', keywords: ['portugal'] }), goal({ id: 'c', kind: 'allgemein', title: 'Portugal lernen' })];
    expect(matchSavingsGoal('sparen portugal', goals)?.id).toBe('b');
    expect(matchSavingsGoal('sparen', goals)).toBeUndefined();
    expect(matchSavingsGoal('sparen xyz', goals)).toBeUndefined();
  });
  it('Fortschritt und Monatsrate', () => {
    const g = goal({ targetDate: '2027-05-12', deposits: [{ id: '1', amount: 250, date: '2026-11-01' }, { id: '2', amount: 150.5, date: '2026-11-05' }] });
    expect(savedAmount(g)).toBe(400.5);
    expect(goalProgress(g)).toBeCloseTo(0.4005);
    expect(monthlyRate(g, '2026-11-12')).toBe(99.92);
    expect(goalProgress(goal({ kind: 'allgemein', status: 'erreicht', targetAmount: undefined }))).toBe(1);
  });
});
